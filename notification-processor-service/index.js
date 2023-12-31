const AWS = require('aws-sdk');
const S3DB = require('@bestselfapp/s3db');
const config = require('./config');
const logger = require('./logger');
const Joi = require('joi');
const processSms = require('./processSms');
const processPush = require('./processPush');

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
    logger.debug('Starting notification processor');

    try {
        // event is passed as an object
        logger.trace(`Raw event:\n${JSON.stringify(event, null, 2)}`);
        
        logger.info(`Processing ${event.notificationType} notification for user ${event.uniqueProperties.userId}, messageId: ${event.uniqueProperties.messageId}`);

        // validate the message
        // message format, see: ./events/validSmsNotification.json
        const { error } = schema.validate(event);
        if (error) {
            logger.error(`Notification Processor - Invalid event message.  Error: ${error}, Message: ${JSON.stringify(event)}`);
            throw error;
        }
        logger.trace('Notification Processor - Message is valid');

        // TODO: process the callbacks here for adaptive message & timing

        if (event.notificationType == 'push') {
            await processPush(event);
        } else if (event.notificationType == 'sms') {
            await processSms(event);
        } else {
            const errMsg = `Invalid notification type: ${event.notificationType} for user ${event.uniqueProperties.userId}, messageId: ${event.uniqueProperties.messageId}`;
            logger.error(errMsg);
            throw new Error(errMsg);
        }

        // log the message
        const logStruct = {
            bucket: config.NOTIFICATION_BUCKET,
            userId: event.uniqueProperties.userId,
            messageId: event.uniqueProperties.messageId,
            message: event.message,
            sendTimeUtc: event.sendTimeUtc,
            actualSendTimeUtc: new Date().toISOString(),
            notificationType: event.notificationType,
        }
        await logMessage(logStruct);

        logger.info(`Successfully sent notification for user ${event.uniqueProperties.userId}, messageId: ${event.uniqueProperties.messageId}`);
    }
    catch (err) {
        logger.error(`Error in notification processor: ${err}`);
        throw err;
    }
};

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
