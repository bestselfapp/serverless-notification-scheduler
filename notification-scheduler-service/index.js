const AWS = require('aws-sdk');
const S3DB = require('@dwkerwin/s3db');
const config = require('./config');
const Joi = require('joi');
const moment = require('moment-timezone');
const createLogger = require('./logger');
let logger = createLogger();

// NOTE: unfortunately, any changes to this schema need to be reproduced in both scheduler and processor
// schema of the SNS payload to the notification scheduler and processor services
const schema = Joi.object({
    uniqueProperties: Joi.object({
        // should uniquely identify the user from the calling application
        userId: Joi.string().min(5).required(),
        // should uniquely identify the message from the calling application
        // e.g. 'dailyReminder' or 'earlyMorningPredictionWarning'
        messageId: Joi.string().min(5).required()
    }).required(),
    scheduleType: Joi.string().valid('one-time', 'recurring').required(),
    notificationType: Joi.string().valid('none', 'push', 'sms', 'email').required(),
    message: Joi.object({
        title: Joi.string().required(),
        subtitle: Joi.string().allow('').optional(),
        body: Joi.any()
            .when('notificationType', {
                is: 'email',
                then: Joi.string().pattern(/^s3:\/\/.*/).required(),
                otherwise: Joi.string().required()
            }),
        messageContentCallbackUrl: Joi.string().allow('').optional(),
    }).required(),
    pushNotificationSettings: Joi.object().unknown(true).optional(),
    smsNotificationSettings: Joi.object({
        phoneNumber: Joi.string().min(10).required(),
        unsubscribeCallbackUrl: Joi.string().allow('').optional(),
    }).optional(),
    emailNotificationSettings: Joi.object({
        emailType: Joi.string().valid('html', 'text').optional(),
        toEmailAddress: Joi.string().email().required(),
        fromEmailAddress: Joi.string().email().required(),
        unsubscribeUrl: Joi.string().uri().allow('').optional(),
    }).optional(),
    sendTimeUtc: Joi.string().required(),
    enableAdaptiveTiming: Joi.boolean().optional(),
    adaptiveTimingCallbackUrl: Joi.string().allow('').optional(),
});

async function processNotification(event) {
    logger.debug('Starting notification scheduler');

    try {
        const message = JSON.parse(event.Records[0].Sns.Message);
        logger.debug(`Processing raw event: ${JSON.stringify(message, null, 2)}`);

        // validate the message
        const { error } = schema.validate(message);
        if (error) {
            logger.error(`Notification Scheduler - Invalid message.  Error: ${error}, Message: ${JSON.stringify(message)}`);
            throw error;
        }
        logger.trace('Notification Scheduler - Message is valid');

        // generate a unique string from the unique properties of the notification
        const Uid = generateUniqueMessageId(message.uniqueProperties.userId, message.uniqueProperties.messageId);
        const correlationId = Uid;
        logger = createLogger(correlationId);

        try {
            const sendTime = new Date(message.sendTimeUtc);
            const sendTimeEstString = convertUtcDateObjectToEstString(sendTime);
            logger.debug(`Notification Scheduler - Input dateStr from SNS message: ${message.sendTimeUtc} (${sendTimeEstString}) for Uid: ${Uid}`);
        } catch (err) {
            logger.error(`Notification Scheduler - Error parsing dateStr: ${message.sendTimeUtc}, Error: ${err}`);
        }

        if (message.notificationType === 'none') {
            // Remove the notification if the type is 'none'
            logger.debug(`Notification Scheduler - Notification type is 'none', removing the notification.`);

            // Find existing time slots for the Uid
            const UidTimeSlots = await findUidTimeSlots(Uid);

            // If it exists, delete the existing notification
            if (UidTimeSlots.length > 0) {
                for (const UidTimeSlot of UidTimeSlots) {
                    logger.trace(`Notification Scheduler - Deleting existing notification in time slot: ${UidTimeSlot}`);
                    await deleteUid(UidTimeSlot, Uid);
                    logger.debug(`Notification Scheduler - Notification ${Uid} deleted from time slot ${UidTimeSlot} (${convertUtcTimeSlotStringToEst(UidTimeSlot)})`);
                }
            } else {
                logger.debug(`Notification Scheduler - Notification ${Uid} does not exist in any existing time slot.`);
            }

            return;
        }
        
        if (message.sendTimeUtc.toLowerCase() === 'now') {
            // if the send time is 'now' we're going to bypass the whole scheduling
            // process and just repost the message event to the processor topic
            // for immediate processing
            logger.debug(`Notification Scheduler - Message is scheduled to be sent immediately.`);
            await postToProcessorTopic(message);
        } else {
            // find the time slot for the notification
            let timeSlot = getTimeSlotFromDateStr(message.sendTimeUtc);
            logger.debug(`Notification Scheduler - Time slot from raw event message: ${timeSlot} (UTC) (${convertUtcTimeSlotStringToEst(timeSlot)})`);

            if (!timeSlot || !timeSlotFormatValid(timeSlot)) {
                const errMsg = `Notification Scheduler - Unable to determine time slot from raw time: ${message.sendTimeUtc}`;
                logger.error(errMsg);
                throw new Error(errMsg);
            }
            logger.debug(`Notification Scheduler - Setting time slot to: ${timeSlot} from raw time: ${message.sendTimeUtc}`);

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
    } catch (err) {
        logger.error(`Error in notification scheduler: ${err}`);
        logger.error(`Stack trace: ${err.stack}`);
        throw err;
    } finally {
        // reset the correlationId
        logger = createLogger(null);
    }
}

// takes a date string and returns a time slot. the date string can be any
// valid date, and the function will return a time slot in 'hh-mm' format,
// representing the hour and minute in UTC. the function also supports the
// string 'now', which is treated as a special time slot itself.
function getTimeSlotFromDateStr(dateStr) {
    logger.debug(`getTimeSlotFromDateStr - Input dateStr: ${dateStr}`);

    try {
        let hours, minutes;

        // Check if the input matches the expected ISO 8601 format
        const isoRegex = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):\d{2}Z$/;
        const isoMatch = dateStr.match(isoRegex);

        if (isoMatch) {
            // Extract hours and minutes from the ISO 8601 format
            [, hours, minutes] = isoMatch;
            logger.debug(`getTimeSlotFromDateStr - Parsed ISO 8601 format. Hours: ${hours}, Minutes: ${minutes}`);
        } else {
            // Attempt to extract time from other potential formats
            const timeRegex = /(\d{1,2}):(\d{2})/;
            const timeMatch = dateStr.match(timeRegex);

            if (timeMatch) {
                [, hours, minutes] = timeMatch;
                logger.debug(`getTimeSlotFromDateStr - Extracted time from non-standard format. Hours: ${hours}, Minutes: ${minutes}`);
            } else {
                throw new Error('Unable to extract time from the provided string');
            }
        }

        // Ensure hours and minutes are valid numbers
        hours = parseInt(hours, 10);
        minutes = parseInt(minutes, 10);

        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw new Error('Invalid hours or minutes');
        }

        // Round minutes down to the nearest 5-minute interval
        minutes = Math.floor(minutes / 5) * 5;

        // Format the time slot
        const timeSlot = `${hours.toString().padStart(2, '0')}-${minutes.toString().padStart(2, '0')}`;
        logger.debug(`getTimeSlotFromDateStr - Generated time slot: ${timeSlot}`);

        return timeSlot;
    } catch (err) {
        logger.error(`getTimeSlotFromDateStr - Error processing dateStr: ${dateStr}`);
        logger.error(`getTimeSlotFromDateStr - Error details: ${err.message}`);
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
    const isValid = /^\d{2}-\d{2}$/.test(timeSlot) || timeSlot.toLowerCase() === 'now';
    if (!isValid) {
        logger.warn(`Invalid time slot format: ${timeSlot}. Expected format: "HH-MM" (e.g., "14-30") or "now".`);
    }
    return isValid;
}

async function deleteUid(timeSlot, Uid) {
    try {
        logger.trace(`deleteUid: timeSlot=${timeSlot}, Uid=${Uid}`)
        // s3 structure: s3://bucketname/notifications/slots/{hh-mm}/{notificationUid}.json
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
        // s3 structure: s3://bucketname/notifications/slots/{hh-mm}/{notificationUid}.json
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

// This function formats UTC date to EST string for log readability. It
// doesn't convert the actual date.
function convertUtcDateObjectToEstString(utcDate) {
    const hours = utcDate.getUTCHours();
    const minutes = utcDate.getUTCMinutes();
    const seconds = utcDate.getUTCSeconds();
    const date = new Date();
    date.setUTCHours(hours, minutes, seconds || 0);
    const estTimeString = date.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });
    return estTimeString;
}

// takes a time slot string in the format "HH-MM" and returns a string in
// the format "hh:mm A EST", again just for log readability
function convertUtcTimeSlotStringToEst(timeSlotStr) {
    try {
        const [hours, minutes] = timeSlotStr.split('-').map(Number);
        const utcMoment = moment.utc().set({ hour: hours, minute: minutes, second: 0 });
        const estTimeString = utcMoment.tz('America/New_York').format('hh:mm A');

        return estTimeString + ' EST';
    } catch (err) {
        console.error(`Error in convertUtcTimeSlotStringToEst: ${err}`);
        throw err;
    }
}

async function postToProcessorTopic(message) {
    // post to the processor SNS topic
    const sns = new AWS.SNS({ region: config.AWS_REGION });
    const params = {
        Message: JSON.stringify(message),
        TopicArn: config.NOTIFICATION_PROCESSOR_TOPIC_ARN
    };
    await sns.publish(params).promise();
    logger.debug(`Message posted to SNS topic: ${config.NOTIFICATION_PROCESSOR_TOPIC_ARN}, message: ${params.Message}`);
}

module.exports.handler = processNotification