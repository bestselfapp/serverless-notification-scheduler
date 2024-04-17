const AWS = require('aws-sdk');
const S3DB = require('@bestselfapp/s3db');
const config = require('./config');
const logger = require('./logger');
const Joi = require('joi');
const axios = require('axios');
const crypto = require('crypto');

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
    }).optional(),
    sendTimeUtc: Joi.date().required(),
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

        try {
            const sendTime = new Date(message.sendTimeUtc);
            const sendTimeEstString = convertUtcDateToEstString(sendTime);
            logger.debug(`Notification Scheduler - Input dateStr from SNS message: ${message.sendTimeUtc} in EST: ${sendTimeEstString}`);
        }
        catch (err) {
            logger.error(`Notification Scheduler - Error parsing dateStr: ${message.sendTimeUtc}`);
            logger.error(`Notification Scheduler - Error: ${err}`);
        }

        // find the time slot for the notification
        let timeSlot = getTimeSlotFromDateStr(message.sendTimeUtc);
        logger.debug(`Notification Scheduler - Time slot from raw event message: ${timeSlot} (UTC) (${convertUtcTimeSlotStringToEst(timeSlot)} EST)`);

        // if there is an adaptive time callback, call it and update the time slot
        if (message.enableAdaptiveTiming && message.adaptiveTimingCallbackUrl) {
            logger.debug(`Notification Scheduler - Adaptive timing enabled via: ${message.adaptiveTimingCallbackUrl}`);
            const adaptiveTimeUtc = await getAdaptiveTime(message.adaptiveTimingCallbackUrl);
            if (adaptiveTimeUtc) {
                timeSlot = getTimeSlotFromDateStr(adaptiveTimeUtc);
                logger.debug(`Notification Scheduler - Updated time slot from adaptive time callback: ${timeSlot} (UTC) (${convertUtcTimeSlotStringToEst(timeSlot)} EST)`);
            } else {
                logger.warn(`Notification Scheduler - Adaptive timing callback error or did not return a valid time.  Will keep original timeslot ${timeSlot} (UTC) (${convertUtcTimeSlotStringToEst(timeSlot)} EST)`);
            }
        }

        if (!timeSlot || !timeSlotFormatValid(timeSlot)) {
            const errMsg = `Notification Scheduler - Unable to determine time slot from raw time: ${message.sendTimeUtc}`;
            logger.error(errMsg);
            throw new Error(errMsg);
        }

        logger.debug(`Notification Scheduler - Proceeding with time slot: ${timeSlot} (UTC) (${convertUtcTimeSlotStringToEst(timeSlot)} EST)`);
        const timeSlotMinutePart = parseInt(timeSlot.split('-')[1]);
        if (timeSlotMinutePart % 5 !== 0) {
            logger.warn(`Notification Scheduler - Time slot ${timeSlot} is not in 5-minute increments.`);
        }
        
        // generate a unique string from the unique properties of the notification
        //const hash = generateHash(message.uniqueProperties.message);
        const Uid = generateUniqueMessageId(message.uniqueProperties.userId, message.uniqueProperties.messageId);

        // check if the unique hash exists in any time slot folder
        const UidTimeSlots = await findUidTimeSlots(Uid);

        // if it does, delete the existing notification
        if (UidTimeSlots.length > 0) {
            for (const UidTimeSlot of UidTimeSlots) {
                if (UidTimeSlot == timeSlot) {
                    logger.debug(`Notification Scheduler - Notification ${Uid} already exists in target time slot ${timeSlot}, will leave it there.`);
                } else {
                    await deleteUid(UidTimeSlot, Uid);
                    logger.debug(`Notification Scheduler - Notification ${Uid} deleted from time slot ${UidTimeSlot}`);
                }
            }
        } else {
            logger.debug(`Notification Scheduler - Notification ${Uid} does not exist in any existing time slot`);
        }

        // if adaptive message
        if (message.message.messageContentCallbackUrl) {
            const adaptiveMessageResponse = await getAdaptiveMessage(message.message.messageContentCallbackUrl);            
            if (adaptiveMessageResponse) {
                message.message = adaptiveMessageResponse;
            } else {
                logger.warn(`Notification Scheduler - Adaptive message callback error or did not return a valid message.  Will use original message instead`);
            }
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
};

function getTimeSlotFromDateStr(dateStr) {
    try {
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

function generateUniqueMessageId(userId, messageId) {
    messageId = messageId.replace(/\s/g, '');
    const strippedMessageId = messageId.replace(/[^a-zA-Z0-9]/g, '');
    if (messageId !== strippedMessageId) {
        logger.warn('Notification Scheduler - Special characters have been stripped from the message ID when generating the unique ID');
    }
    return `${userId}-${strippedMessageId}`;
}

// returns the time slot folder the Uid is found in, or null if not found
async function findUidTimeSlots(Uid) {
    try {
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, 'notifications/slots');
        const allPaths = await s3db.list();
        //logger.trace(`All paths from s3db.list(): ${allPaths}`);
        let timeSlotsWithUid = [];
        for (const path of allPaths) {
            if (path.includes(Uid)) {
                logger.trace(`UID ${Uid} found in path ${path}`);
                // Extract the time slot folder from the path
                const timeSlotFolder = path.split('/')[1];
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
    return /^\d{2}-\d{2}$/.test(timeSlot);
}

async function deleteUid(timeSlot, Uid) {
    try {
        // s3 structure: s3://bsa-pdata-dev-us-east-1/notifications/slots/{hh-mm}/{notificationUid}.json
        //logger.trace(`Notification Scheduler - Deleting existing notification in time slot: ${timeSlot}`);
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, `notifications/slots/${timeSlot}`);
        await s3db.delete(`${Uid}.json`);
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
        await s3db.put(`${Uid}.json`, message);
        logger.info(`Notification Scheduler - Saved notification ${Uid} to time slot ${timeSlot}`);
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in saveNotification: ${err}`);
        throw err;
    }
}

// returns a redacted version of the secret string with only the first and
// last 4 characters visible
function redactSecretString(secret) {
    const start = secret.substring(0, 4);
    const end = secret.substring(secret.length - 4);
    const redactedSecret = start + secret.substring(4, secret.length - 4).replace(/./g, '*') + end;
    return redactedSecret;
}

async function getAdaptiveTime(adaptiveTimingCallbackUrl) {
    try {
        const redactedApiKey = redactSecretString(process.env.BSA_CALLBACKS_APIKEY);
        logger.debug(`Notification Scheduler - Adaptive timing callback URL: ${adaptiveTimingCallbackUrl}, API Key: ${redactedApiKey}`);
        // call the adaptive timing callback
        const adaptiveTimingResponse = await axios.get(adaptiveTimingCallbackUrl, {
            headers: {
                'bsa-callbacks-apikey': process.env.BSA_CALLBACKS_APIKEY
            }
        });
        logger.debug(`Notification Scheduler - Adaptive timing response: ${adaptiveTimingResponse.data}`);
        return adaptiveTimingResponse.data;
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in getAdaptiveTime: ${err}`);
        //throw err;
        return null;
    }
}

async function getAdaptiveMessage(messageContentCallbackUrl) {
    try {
        const redactedApiKey = redactSecretString(process.env.BSA_CALLBACKS_APIKEY);
        logger.debug(`Notification Scheduler - Adaptive message callback URL: ${messageContentCallbackUrl}, API Key: ${redactedApiKey}`);
        // call the adaptive message callback
        const adaptiveMessageResponse = await axios.get(messageContentCallbackUrl, {
            headers: {
                'bsa-callbacks-apikey': process.env.BSA_CALLBACKS_APIKEY
            }
        });
        logger.debug(`Notification Scheduler - Adaptive message response: ${adaptiveMessageResponse.data}`);
        return adaptiveMessageResponse.data;
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in getAdaptiveMessage: ${err}`);
        //throw err;
        return null;
    }
}

// this function seems to be correctly returning the time in EST (not off my 1 hour)
function convertUtcDateToEstString(utcDate) {
    const hours = utcDate.getUTCHours();
    const minutes = utcDate.getUTCMinutes();
    const seconds = utcDate.getUTCSeconds();
    const date = new Date();
    date.setUTCHours(hours, minutes, seconds || 0);
    const estTimeString = date.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });
    return estTimeString;
}

const moment = require('moment-timezone');
function convertUtcTimeSlotStringToEst(timeStr) {
    try {
        // Split the time string into hours and minutes
        const [hours, minutes] = timeStr.split('-').map(Number);

        // Create a moment object for the current date and specified time in UTC
        const utcMoment = moment.utc().set({ hour: hours, minute: minutes, second: 0 });

        // Convert the moment object to the local time string in EST
        const estTimeString = utcMoment.tz('America/New_York').format('hh:mm A');

        return estTimeString;
    } catch (err) {
        console.error(`Error in convertUtcTimeSlotStringToEst: ${err}`);
        throw err;
    }
}

module.exports.handler = processNotification
