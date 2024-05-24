const AWS = require('aws-sdk');
const S3DB = require('@dwkerwin/s3db');
const axios = require('axios');
const config = require('./config');
const Joi = require('joi');
const processSms = require('./processSms');
const processPush = require('./processPush');
const createLogger = require('./logger');
let logger = createLogger();

// NOTE: unfortunately, any changes to this schema need to be reproduced in both scheduler and processor
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
        unsubscribeCallbackUrl: Joi.string().allow('').optional(),
    }).optional(),
    sendTimeUtc: Joi.string().required(),
    enableAdaptiveTiming: Joi.boolean().optional(),
    adaptiveTimingCallbackUrl: Joi.string().allow('').optional(),
});

async function processNotification(event) {
    logger.debug('Starting notification processor');

    try {
        // event is passed as an object
        logger.trace(`Raw event:\n${JSON.stringify(event, null, 2)}`);

        // Extract the first record and parse the message
        const message = JSON.parse(event.Records[0].Sns.Message);

        // Extract the values
        const notificationType = message.notificationType;
        const userId = message.uniqueProperties.userId;
        const messageId = message.uniqueProperties.messageId;

        const correlationId = `${userId}-${messageId}`;
        logger = createLogger(correlationId);

        logger.info(`Processing ${notificationType} notification for user ${userId}, messageId: ${messageId}`);

        // validate the message
        // message format, see: ./events/validSmsNotification.json
        const { error } = schema.validate(message);
        if (error) {
            logger.error(`Notification Processor - Invalid event message.  Error: ${error}, Message: ${JSON.stringify(message)}`);
            throw error;
        }
        logger.trace('Notification Processor - Message is valid');

        if (await canSendNotification(message.uniqueProperties.userId) === false) {
            logger.warn(`Notification Processor - Cannot send notification to user ${userId} at this time, send limits exceeded`);
            return;
        }

        // if adaptive message
        if (message.message.messageContentCallbackUrl) {
            const adaptiveMessageResponse = await getAdaptiveMessage(message.message.messageContentCallbackUrl);            
            if (adaptiveMessageResponse) {
                message.message.body = adaptiveMessageResponse;
            } else {
                logger.warn(`Notification Processor - Adaptive message callback error or did not return a valid message.  Will use original message instead`);
            }
        }

        if (notificationType == 'push') {
            await processPush(message);
        } else if (notificationType == 'sms') {
            await processSms(message);
        } else {
            const errMsg = `Invalid notification type: ${notificationType} for user ${userId}, messageId: ${messageId}`;
            logger.error(errMsg);
            throw new Error(errMsg);
        }

        // log the message
        const logStruct = {
            bucket: config.NOTIFICATION_BUCKET,
            userId: userId,
            messageId: messageId,
            message: message.message,
            sendTimeUtc: message.sendTimeUtc,
            actualSendTimeUtc: new Date().toISOString(),
            notificationType: notificationType,
        }
        await logMessage(logStruct);

        logger.info(`Successfully sent notification for user ${userId}, messageId: ${messageId}`);

        // TODO: process the message timing callback here
        // if adaptive timing returns a new time, reschedule the message by
        // calling the scheduler with the new time

    }
    catch (err) {
        logger.error(`Error in notification processor: ${err}`);
        logger.error(`Stack trace: ${err.stack}`);
        logger.error(`Event: ${JSON.stringify(event, null, 2)}`);
        throw err;
    }
    finally {
        // reset the correlationId
        logger = createLogger(null);
    }
};

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
        const redactedApiKey = redactSecretString(config.BSA_CALLBACKS_APIKEY);
        logger.debug(`Notification Processor - Adaptive timing callback URL: ${adaptiveTimingCallbackUrl}, API Key: ${redactedApiKey}`);
        // call the adaptive timing callback
        const adaptiveTimingResponse = await axios.get(adaptiveTimingCallbackUrl, {
            headers: {
                'bsa-callbacks-apikey': config.BSA_CALLBACKS_APIKEY
            }
        });
        logger.debug(`Notification Processor - Adaptive timing response: ${adaptiveTimingResponse.data}`);
        return adaptiveTimingResponse.data;
    }
    catch (err) {
        logger.error(`Notification Processor - Error in getAdaptiveTime: ${err}`);
        //throw err;
        return null;
    }
}

async function getAdaptiveMessage(messageContentCallbackUrl) {
    try {
        const redactedApiKey = redactSecretString(config.BSA_CALLBACKS_APIKEY);
        logger.debug(`Notification Processor - Adaptive message callback URL: ${messageContentCallbackUrl}, API Key: ${redactedApiKey}`);
        // call the adaptive message callback
        const adaptiveMessageResponse = await axios.get(messageContentCallbackUrl, {
            headers: {
                'bsa-callbacks-apikey': config.BSA_CALLBACKS_APIKEY
            }
        });
        logger.debug(`Notification Processor - Adaptive message response: ${adaptiveMessageResponse.data}`);
        return adaptiveMessageResponse.data;
    }
    catch (err) {
        logger.error(`Notification Processor - Error in getAdaptiveMessage: ${err}`);
        //throw err;
        return null;
    }
}

async function canSendNotification(userId) {
    try {
        logger.debug(`Checking notification usage vs limits for user ${userId}`)
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, 'userNotificationMetrics');
        let record = await s3db.get(userId, { returnNullIfNotFound: true });

        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

        // If the record doesn't exist, create a new one
        if (!record) {
            record = {
                hourly: { count: 0, timestamp: now },
                daily: { count: 0, timestamp: now }
            };
        } else {
            // Delete the record if it's more than a week old
            if (record.hourly.timestamp < oneWeekAgo || record.daily.timestamp < oneWeekAgo) {
                await s3db.delete(userId);
                record = { hourly: { count: 0, timestamp: now }, daily: { count: 0, timestamp: now } };
            }
        }
        
        // Initialize counts if they don't exist or if the timestamps are too old
        if (!record.hourly || record.hourly.timestamp < oneHourAgo) {
            record.hourly = { count: 0, timestamp: now };
        }
        if (!record.daily || record.daily.timestamp < oneDayAgo) {
            record.daily = { count: 0, timestamp: now };
        }

        // Check if we can send a notification
        if (record.hourly.count >= config.MAX_NOTIFICATIONS_PER_USER_PER_HOUR) {
            logger.warn(`Cannot send notification to user ${userId} because the hourly limit of ${config.MAX_NOTIFICATIONS_PER_USER_PER_HOUR} has been reached. ${record.hourly.count} notifications have been sent in the last hour.`);
            return false;
        }
        if (record.daily.count >= config.MAX_NOTIFICATIONS_PER_USER_PER_DAY) {
            logger.warn(`Cannot send notification to user ${userId} because the daily limit of ${config.MAX_NOTIFICATIONS_PER_USER_PER_DAY} has been reached. ${record.daily.count} notifications have been sent today.`);
            return false;
        }

        // Increment counts and update timestamps
        record.hourly.count++;
        record.hourly.timestamp = now;
        record.daily.count++;
        record.daily.timestamp = now;

        // Update the record in S3
        await s3db.put(userId, record);

        return true;
    } catch (error) {
        logger.error(`An error occurred while checking notification usage for user ${userId}: ${error.message}`);
        throw error;
    }
}

async function logMessage(logStruct) {
    /* logStruct format:
    {
        bucket,
        userId,
        messageId,
        message,
        sendTimeUtc,        // time scheduled to send
        actualSendTimeUtc,  // time actually sent
        notificationType,   // push or sms
        result              // success or failure
    }
    */
    /* log file format:
    {
        messages: [
            {
                messageId,
                message,
                sendTimeUtc,
                actualSendTimeUtc,
                notificationType,
                result
            },
        ]
    }
    */
    try {
        const userLogFile = `${logStruct.userId}.json`;
        const s3db = new S3DB(logStruct.bucket, 'logs/');
        let logFile = await s3db.get(userLogFile, { returnNullIfNotFound: true });
        if (!logFile) {
            logFile = { messages: [] };
        }
        logFile.messages.push({
            messageId: logStruct.messageId,
            message: logStruct.message,
            sendTimeUtc: logStruct.sendTimeUtc,
            actualSendTimeUtc: logStruct.actualSendTimeUtc,
            notificationType: logStruct.notificationType,
            result: logStruct.result,
        });
        // sort messages with the most recent (actualSendTimeUtc) at the bottom of the file
        logFile.messages.sort((a, b) => {
            return new Date(a.actualSendTimeUtc) - new Date(b.actualSendTimeUtc);
        });
        await s3db.put(userLogFile, logFile, { formatForReadability: true });
        logger.trace(`Logged message to ${logStruct.bucket}/${userLogFile}`);
    }
    catch (err) {
        logger.error(`Error logging message: ${err}`);
        throw err;
    }
}

module.exports.handler = processNotification;
