const AWS = require('aws-sdk');
const S3DB = require('@bestselfapp/s3db');
const config = require('./config');
const logger = require('./logger');
const Joi = require('joi');
const axios = require('axios');
const crypto = require('crypto');

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
    notificationType: Joi.string().valid('push', 'sms').required(),
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

        // validate the message
        const { error } = schema.validate(message);
        if (error) {
            logger.error(`Notification Scheduler - Invalid message.  Error: ${error}, Message: ${JSON.stringify(message)}`);
            throw error;
        }
        logger.debug('Notification Scheduler - Message is valid');

        // find the time slot for the notification
        let timeSlot = '';
        // if there is an adaptive time callback, call it and update the time slot
        if (message.enableAdaptiveTiming && message.adaptiveTimingCallbackUrl) {
            logger.debug('Notification Scheduler - Adaptive timing enabled');
            const adaptiveTimeUtc = await getAdaptiveTime(message.adaptiveTimingCallbackUrl);
            if (adaptiveTimeUtc) {
                timeSlot = getTimeSlotFromDateStr(adaptiveTimeUtc);
                logger.debug(`Notification Scheduler - Setting time slot to ${timeSlot} from adative time callback value ${adaptiveTimeUtc}`);
            } else {
                logger.warn(`Notification Scheduler - Adaptive timing callback did not return a valid time.  Will use sendTimeUtc instead`);
            }
        }
        if (!timeSlot) {
            timeSlot = getTimeSlotFromDateStr(message.sendTimeUtc);
            if (!timeSlot || !timeSlotFormatValid(timeSlot)) {
                const errMsg = `Notification Scheduler - Unable to determine time slot from raw time: ${message.sendTimeUtc}`;
                logger.error(errMsg);
                throw new Error(errMsg);
            }
            logger.debug(`Notification Scheduler - Setting time slot to: ${timeSlot} from raw time: ${message.sendTimeUtc}`);
        }

        const timeSlotMinutePart = parseInt(timeSlot.split('-')[1]);
        if (timeSlotMinutePart % 5 !== 0) {
            logger.warn(`Notification Scheduler - Time slot ${timeSlot} is not in 5-minute increments.`);
        }
        
        // generate a unique string from the unique properties of the notification
        //const hash = generateHash(message.uniqueProperties.message);
        const Uid = generateUniqueMessageId(message.uniqueProperties.userId, message.uniqueProperties.messageId);

        // check if the unique hash exists in any time slot folder
        const UidTimeSlot = await findUidTimeSlot(Uid);

        // if it does, delete the existing notification
        if (UidTimeSlot) {
            if (UidTimeSlot == timeSlot) {
                logger.debug(`Notification Scheduler - Notification ${Uid} already exists in time slot ${timeSlot}, will ignore.`);
            } else {
                await deleteUid(UidTimeSlot, Uid);
            }
        }

        // if adaptive message
        if (message.message.messageContentCallbackUrl) {
            const adaptiveMessageResponse = await getAdaptiveMessage(message.message.messageContentCallbackUrl);            
            message.message = adaptiveMessageResponse;
        }

        // save the notification to the time slot folder
        // (even if it already exists, we want to overwrite any non-unique properties)
        await saveNotification(timeSlot, Uid, message);
    }
    catch (err) {
        logger.error(`Error in notification scheduler: ${err}`);
        throw err;
    }
};

function getTimeSlotFromDateStr(dateStr) {
    const sendTime = new Date(dateStr);
    const hours = sendTime.getUTCHours().toString().padStart(2, '0');
    const minutes = sendTime.getUTCMinutes().toString().padStart(2, '0');
    const timeSlot = `${hours}-${minutes}`;
    logger.trace(`Retrieved timeSlot=${timeSlot} from dateStr=${dateStr}`);
    return timeSlot;
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
async function findUidTimeSlot(Uid) {
    try {
        // s3 structure: s3://bsa-pdata-dev-us-east-1/notifications/slots/{hh-mm}/{notificationUid}.json
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, 'notifications/slots');
        const timeSlotFolders = await s3db.list();
        for (const timeSlotFolder of timeSlotFolders) {
            const UidsInTimeSlot = await s3db.list(timeSlotFolder);
            if (UidsInTimeSlot.includes(Uid)) {
                return timeSlotFolder;
            }
        }
        return null;
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
        logger.debug(`Notification Scheduler - Deleting existing notification in time slot: ${timeSlot}`);
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, `notifications/slots/${timeSlot}`);
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
        logger.debug(`Notification Scheduler - Saving notification to time slot: ${timeSlot}`);
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, `notifications/slots/${timeSlot}`);
        await s3db.put(`${Uid}.json`, message);
        logger.info(`Notification Scheduler - Saved notification ${Uid} to time slot ${timeSlot}`);
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in saveNotification: ${err}`);
        throw err;
    }
}

async function getAdaptiveTime(adaptiveTimingCallbackUrl) {
    try {
        logger.debug(`Notification Scheduler - Adaptive timing callback URL: ${adaptiveTimingCallbackUrl}`);
        // call the adaptive timing callback
        const adaptiveTimingResponse = await axios.get(adaptiveTimingCallbackUrl);
        logger.debug(`Notification Scheduler - Adaptive timing response: ${adaptiveTimingResponse.data}`);
        return adaptiveTimingResponse.data;
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in getAdaptiveTime: ${err}`);
        throw err;
    }
}

async function getAdaptiveMessage(messageContentCallbackUrl) {
    try {
        logger.debug(`Notification Scheduler - Adaptive message callback URL: ${messageContentCallbackUrl}`);
        // call the adaptive message callback
        const adaptiveMessageResponse = await axios.get(messageContentCallbackUrl);
        logger.debug(`Notification Scheduler - Adaptive message response: ${adaptiveMessageResponse.data}`);
        return adaptiveMessageResponse.data;
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in getAdaptiveMessage: ${err}`);
        throw err;
    }
}

module.exports.handler = processNotification
