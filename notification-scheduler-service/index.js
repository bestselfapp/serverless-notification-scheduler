const AWS = require('aws-sdk');
const S3DB = require('@dwkerwin/s3db');
const config = require('./config');
const Joi = require('joi');
const createLogger = require('./logger');
let logger = createLogger();

// NOTE: this needs to be updated in both scheduler and processor
const schema = Joi.object({
    // Define your schema here based on the structure of the sample message
    // For example:
    uniqueProperties: Joi.object({
        // should uniquely identify the user from the calling application
        userId: Joi.string().min(5).required(),
        // should uniquely identify the message from the calling application
        // e.g. 'dailyReminder' or 'earlyMorningPredictionWarning'
        messageId: Joi.string().min(5).required()
    }).required(),
    message: Joi.object({
        title: Joi.string().required(),
        subtitle: Joi.string().allow('').optional(),
        body: Joi.string().required(),
        messageContentCallbackUrl: Joi.string().allow('').optional(),
    }).required(),
    scheduleType: Joi.string().valid('one-time', 'recurring').required(),
    notificationType: Joi.string().valid('none', 'push', 'sms').required(),
    pushNotificationSettings: Joi.object().unknown(true).optional(),
    smsNotificationSettings: Joi.object({
        phoneNumber: Joi.string().min(10).required(),
        unsubscribeCallbackUrl: Joi.string().allow('').optional(),
    }).optional(),
    sendTimeUtc: Joi.string().required(),
    enableAdaptiveTiming: Joi.boolean().optional(),
    adaptiveTimingCallbackUrl: Joi.string().allow('').optional(),
});

async function processNotification(event) {
    logger.debug('Starting notification scheduler');

    try {
        const message = JSON.parse(event.Records[0].Sns.Message);
        logger.trace(`Processing raw event: ${JSON.stringify(message, null, 2)}`);

        // validate the message
        const { error } = schema.validate(message);
        if (error) {
            logger.error(`Notification Scheduler - Invalid message.  Error: ${error}, Message: ${JSON.stringify(message)}`);
            throw error;
        }
        logger.trace('Notification Scheduler - Message is valid');

        // generate a unique string from the unique properties of the notification
        //const hash = generateHash(message.uniqueProperties.message);
        const Uid = generateUniqueMessageId(message.uniqueProperties.userId, message.uniqueProperties.messageId);
        const correlationId = Uid;
        logger = createLogger(correlationId);

        try {
            const sendTime = new Date(message.sendTimeUtc);
            const sendTimeEstString = convertUtcDateObjectToEstString(sendTime);
            logger.debug(`Notification Scheduler - Input dateStr from SNS message: ${message.sendTimeUtc} (${sendTimeEstString}) for Uid: ${Uid}`);
        }
        catch (err) {
            logger.error(`Notification Scheduler - Error parsing dateStr: ${message.sendTimeUtc}`);
            logger.error(`Notification Scheduler - Error: ${err}`);
        }

        // find the time slot for the notification
        let timeSlot = getTimeSlotFromDateStr(message.sendTimeUtc);
        logger.debug(`Notification Scheduler - Time slot from raw event message: ${timeSlot} (UTC) (${convertUtcTimeSlotStringToEst(timeSlot)})`);

        if (!timeSlot || !timeSlotFormatValid(timeSlot)) {
            const errMsg = `Notification Scheduler - Unable to determine time slot from raw time: ${message.sendTimeUtc}`;
            logger.error(errMsg);
            throw new Error(errMsg);
        }

        const timeSlotMinutePart = parseInt(timeSlot.split('-')[1]);
        if (timeSlotMinutePart % 5 !== 0) {
            logger.warn(`Notification Scheduler - Time slot ${timeSlot} is not in 5-minute increments.`);
        }
        
        // check if the unique hash exists in any time slot folder
        const UidTimeSlots = await findUidTimeSlots(Uid);

        // if it does, delete the existing notification
        if (UidTimeSlots.length > 0) {
            for (const UidTimeSlot of UidTimeSlots) {
                logger.trace(`Notification Scheduler - Checking existing notification in time slot: ${UidTimeSlot}`)
                if (UidTimeSlot == timeSlot) {
                    logger.debug(`Notification Scheduler - Notification ${Uid} already exists in target time slot ${timeSlot} (${convertUtcTimeSlotStringToEst(timeSlot)}), will leave it there.`);
                } else {
                    await deleteUid(UidTimeSlot, Uid);
                    logger.debug(`Notification Scheduler - Notification ${Uid} deleted from time slot ${UidTimeSlot} (${convertUtcTimeSlotStringToEst(UidTimeSlot)}`);
                }
            }
        } else {
            logger.debug(`Notification Scheduler - Notification ${Uid} does not exist in any existing time slot, will add to time slot ${timeSlot} (${convertUtcTimeSlotStringToEst(timeSlot)})`);
        }

        // save the notification to the time slot folder
        // (even if it already exists, we want to overwrite any non-unique properties)
        await saveNotification(timeSlot, Uid, message);
    }
    catch (err) {
        logger.error(`Error in notification scheduler: ${err}`);
        logger.error(`Stack trace: ${err.stack}`);
        throw err;
    }
    finally {
        // reset the correlationId
        logger = createLogger(null);
    }
};

function getTimeSlotFromDateStr(dateStr) {
    try {
        if (dateStr.toLowerCase() === 'now') {
            return 'now';
        }

        logger.trace(`getTimeSlotFromDateStr - Will attempt to parse time slot from input dateStr: ${dateStr}`);
        const sendTime = new Date(dateStr);
        const hours = sendTime.getUTCHours().toString().padStart(2, '0');
        const minutes = sendTime.getUTCMinutes().toString().padStart(2, '0');
        const timeSlot = `${hours}-${minutes}`;
        return timeSlot;
    } catch (err) {
        logger.error(`getTimeSlotFromDateStr - Error parsing dateStr: ${dateStr}`);
        logger.error(`getTimeSlotFromDateStr - Error: ${err}`);
        throw err;
    }
}

// generates a unique message ID from the user ID and message ID
// removes special characters from the message ID
// returns a string in the format: {userId}-{messageId}
function generateUniqueMessageId(userId, messageId) {
    messageId = messageId.replace(/\s/g, '');
    const strippedMessageId = messageId.replace(/[^a-zA-Z0-9]/g, '');
    if (messageId !== strippedMessageId) {
        logger.warn('Notification Scheduler - Special characters have been stripped from the message ID when generating the unique ID');
    }
    return `${userId}-${strippedMessageId}`;
}

// returns the time slot folder the Uid is found in, or null if not found
// returns an array like ['hh-mm', 'hh-mm', ...]
async function findUidTimeSlots(Uid) {
    try {
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, 'notifications/slots');
        const allPaths = await s3db.list();
        logger.trace(`All paths from s3db.list(): ${allPaths}`);
        //logger.trace(`All paths from s3db.list(): ${allPaths}`);
        let timeSlotsWithUid = [];
        for (const path of allPaths) {
            if (path.includes(Uid)) {
                logger.trace(`UID ${Uid} found in path ${path}`);
                // Extract the time slot folder from the path
                const timeSlotFolder = path.split('/')[0];
                timeSlotsWithUid.push(timeSlotFolder);
                logger.debug(`UID ${Uid} found in existing time slot ${timeSlotFolder}`);
            }
        }
        // Remove duplicates from timeSlotsWithUid
        timeSlotsWithUid = [...new Set(timeSlotsWithUid)];
        return timeSlotsWithUid;
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in findUidinExistingTimeSlot: ${err}`);
        throw err;
    }
}

function timeSlotFormatValid(timeSlot) {
    return /^\d{2}-\d{2}$/.test(timeSlot) || timeSlot.toLowerCase() === 'now';
}

async function deleteUid(timeSlot, Uid) {
    try {
        logger.trace(`deleteUid: timeSlot=${timeSlot}, Uid=${Uid}`)
        // s3 structure: s3://bsa-pdata-dev-us-east-1/notifications/slots/{hh-mm}/{notificationUid}.json
        //logger.trace(`Notification Scheduler - Deleting existing notification in time slot: ${timeSlot}`);
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, `notifications/slots/${timeSlot}`);
        if (!s3db.exists(Uid)) {
            logger.warn(`Notification Scheduler - Wants to delete a notification that can not be found at s3://${config.NOTIFICATION_BUCKET}/notifications/slots/${timeSlot}/${Uid}.json`);
        }
        await s3db.delete(Uid);
        logger.info(`Notification Scheduler - Deleted existing notification ${Uid} in time slot ${timeSlot}`);
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in deleteUid: ${err}`);
        throw err;
    }
}

async function saveNotification(timeSlot, Uid, message) {
    try {
        // s3 structure: s3://bsa-pdata-dev-us-east-1/notifications/slots/{hh-mm}/{notificationUid}.json
        logger.trace(`Notification Scheduler - Saving notification to time slot: ${timeSlot}`);
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, `notifications/slots/${timeSlot}`);
        await s3db.put(Uid, message);
        logger.info(`Notification Scheduler - Saved notification ${Uid} to time slot ${timeSlot}`);
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in saveNotification: ${err}`);
        throw err;
    }
}

// this function seems to be correctly returning the time in EST (not off my 1 hour)
function convertUtcDateObjectToEstString(utcDate) {
    const hours = utcDate.getUTCHours();
    const minutes = utcDate.getUTCMinutes();
    const seconds = utcDate.getUTCSeconds();
    const date = new Date();
    date.setUTCHours(hours, minutes, seconds || 0);
    const estTimeString = date.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });
    return estTimeString;
}

const moment = require('moment-timezone');
// takes a time slot string in the format "HH-MM" and returns a string in the format "hh:mm A EST"
function convertUtcTimeSlotStringToEst(timeSlotStr) {
    try {
        // Split the time string into hours and minutes
        const [hours, minutes] = timeSlotStr.split('-').map(Number);

        // Create a moment object for the current date and specified time in UTC
        const utcMoment = moment.utc().set({ hour: hours, minute: minutes, second: 0 });

        // Convert the moment object to the local time string in EST
        const estTimeString = utcMoment.tz('America/New_York').format('hh:mm A');

        return estTimeString + ' EST';
    } catch (err) {
        console.error(`Error in convertUtcTimeSlotStringToEst: ${err}`);
        throw err;
    }
}

module.exports.handler = processNotification
