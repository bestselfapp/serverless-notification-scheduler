const AWS = require('aws-sdk');
const S3DB = require('@dwkerwin/s3db');
const axios = require('axios');
const config = require('./config');
const Joi = require('joi');
const processSms = require('./processSms');
const processPush = require('./processPush');
const processEmail = require('./processEmail');
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

        // if adaptive message, try the callback URL and if a message is returned,
        // use that message instead of the original message
        if (message.message.messageContentCallbackUrl) {
            const adaptiveMessageResponse = await getAdaptiveMessage(message.message.messageContentCallbackUrl);            
            if (adaptiveMessageResponse) {
                message.message.body = adaptiveMessageResponse;
                logger.debug(`Notification Processor - Using adaptive message: ${adaptiveMessageResponse}`);
            } else {
                logger.warn(`Notification Processor - Adaptive message callback error or did not return a valid message.  Will use original message instead`);
            }
        } else {
            logger.debug(`Notification Processor - No adaptive message callback URL provided`);
        }

        if (notificationType == 'push') {
            await processPush(message);
        } else if (notificationType == 'sms') {
            await processSms(message);
        } else if (notificationType == 'email') {
            await processEmail(message);
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
        logger.error(`Error in notification processor: ${err}\nStack trace: ${err.stack}\nEvent: ${JSON.stringify(event, null, 2)}`);
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

// This is a safeguard to prevent the system from overloading a user with
// notifications. It ensures that the number of notifications sent to a user
// does not exceed the maximum limits set per hour and per day. This relies
// on the logging function.
async function canSendNotification(userId) {
    try {
        const userLogFile = `${userId}.json`;
        const s3db = new S3DB(config.NOTIFICATION_BUCKET, 'logs/');
        let logFile = await s3db.get(userLogFile, { returnNullIfNotFound: true });

        if (!logFile) {
            // If there's no log file, we can send a notification
            logger.debug(`canSendNotification - No log file found for user ${userId}, can send notification`);
            return true;
        }

        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;
        const oneDayAgo = now - 24 * 60 * 60 * 1000;

        const hourlyMessages = logFile.messages.filter(message => {
            return new Date(message.actualSendTimeUtc) >= oneHourAgo;
        });

        const dailyMessages = logFile.messages.filter(message => {
            return new Date(message.actualSendTimeUtc) >= oneDayAgo;
        });

        // Check if we've reached the hourly limit
        if (hourlyMessages.length >= config.MAX_NOTIFICATIONS_PER_USER_PER_HOUR) {
            const recentHourlyMessages = hourlyMessages.slice(-5);
            logger.debug(`canSendNotification - User ${userId} has reached the hourly limit of ${HOURLY_LIMIT} messages.`);
            logger.trace(`canSendNotification - Recent hourly messages for user ${userId}: ${JSON.stringify(recentHourlyMessages)}`);
            return false;
        }

        // Check if we've reached the daily limit
        if (dailyMessages.length >= config.MAX_NOTIFICATIONS_PER_USER_PER_DAY) {
            const recentDailyMessages = dailyMessages.slice(-5);
            logger.debug(`canSendNotification - User ${userId} has reached the daily limit of ${DAILY_LIMIT} messages.`);
            logger.trace(`canSendNotification - Recent daily messages for user ${userId}: ${JSON.stringify(recentDailyMessages)}`);
            return false;
        }

        logger.debug(`canSendNotification - All clear, user ${userId} has not reached the hourly or daily message limit.`);
        return true;

        logger.debug(`canSendNotification - All clear, user ${userId} has not reached the hourly or daily message limit.`);
        return true;
    }
    catch (err) {
        logger.error(`canSendNotification - Error checking if we can send notification for user ${userId}: ${err}`);
        throw err;
    }
}

module.exports.handler = processNotification;
