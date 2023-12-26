const AWS = require('aws-sdk');
const S3DB = require('@bestselfapp/s3db');
const config = require('./config');
const logger = require('./logger');
const Joi = require('joi');
const axios = require('axios');

const schema = Joi.object({
    // Define your schema here based on the structure of the sample message
    // For example:
    uniqueProperties: Joi.object({
        message: Joi.object({
            title: Joi.string().required(),
            subtitle: Joi.string().optional(),
            body: Joi.string().required(),
            messageContentCallbackUrl: Joi.string().optional(),
        }).required(),
        scheduleType: Joi.string().valid('one-time', 'recurring').required(),
    }).required(),
    notificationType: Joi.string().valid('push', 'sms').required(),
    pushNotificationSettings: Joi.object().unknown(true).optional,
    smsNotificationSettings: Joi.object({
        phoneNumber: Joi.string().min(10).required(),
    }).optional(),
    sendTimeUtc: Joi.date().required(),
    enableAdaptiveTiming: Joi.boolean().optional(),
    adaptiveTimingCallbackUrl: Joi.string().optional(),
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
        if (message.enableAdaptiveTiming) {
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
            logger.debug(`Notification Scheduler - Setting time slot to: ${timeSlot} from raw time: ${message.sendTimeUtc}`);
        }

        // generate a unique string from the unique properties of the notification
        const hash = generateHash(uniqueProperties.message);
        const Uid = `${hash}-${message.uniqueProperties.scheduleType === 'one-time' ? 'O' : 'R'}`;

        // check if the unique hash exists in any time slot folder
        const UidTimeSlot = await findUidTimeSlot(Uid);

        // if it does, delete the existing notification
        if (UidTimeSlot) {
            await deleteUid(timeSlot, Uid);
        }

        // save the notification to the time slot folder
        await saveNotification(timeSlot, Uid, message);
    }
    catch (err) {
        logger.error(`Error in notification scheduler: ${err}`);
        throw err;
    }
};

function getTimeSlotFromDateStr(dateStr) {
    const sendTime = new Date(date);
    const hours = sendTime.getUTCHours().toString().padStart(2, '0');
    const minutes = sendTime.getUTCMinutes().toString().padStart(2, '0');
    const timeSlot = `${hours}-${minutes}`;
    return timeSlot;
}

function generateHash(obj) {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(obj));
    return hash.digest('hex');
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
        await s3db.put(Uid, message);
        logger.info(`Notification Scheduler - Saved notification ${Uid} to time slot ${timeSlot}`);
    }
    catch (err) {
        logger.error(`Notification Scheduler - Error in saveNotification: ${err}`);
        throw err;
    }
}

async function getAdaptiveTime(adaptiveTimingCallbackUrl) {
    logger.debug(`Notification Scheduler - Adaptive timing callback URL: ${adaptiveTimingCallbackUrl}`);

    // call the adaptive timing callback
    const adaptiveTimingResponse = await axios.get(adaptiveTimingCallbackUrl);
    logger.debug(`Notification Scheduler - Adaptive timing response: ${adaptiveTimingResponse}`);

}

module.exports.handler = handler
