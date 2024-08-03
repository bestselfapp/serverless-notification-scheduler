const config = require('../config');
const crypto = require('crypto');
const S3DB = require('@dwkerwin/s3db');
const createLogger = require('../logger');
let logger = createLogger();

const rewire = require('rewire');
const index = rewire('../index');
const getTimeSlotFromDateStr = index.__get__('getTimeSlotFromDateStr');

module.exports.alterSnsPayload = function(messageObj, options) {
    const notificationMessageObj = JSON.parse(messageObj.Records[0].Sns.Message);
    if (options.changeToNewUserId) {
        notificationMessageObj.uniqueProperties.userId = generateNewUniqueUserId();
    }
    if (options.changeMessageId) {
        notificationMessageObj.uniqueProperties.messageId = options.changeMessageId;
    }
    if (options.changeSendTimeUtc) {
        notificationMessageObj.sendTimeUtc = options.changeSendTimeUtc;
    }
    if (options.changeNotificationType) {
        notificationMessageObj.notificationType = options.changeNotificationType;
    }
    messageObj.Records[0].Sns.Message = JSON.stringify(notificationMessageObj);
    logger.trace(`alterSnsPayload - Payload altered: ${JSON.stringify(notificationMessageObj, null, 2)}`);
    return messageObj;
}

function generateNewUniqueUserId() {
    return 'TEST' + crypto.randomBytes(12).toString('hex');
}

module.exports.getKeyPropertiesFromSnsPayload = function(messageObj) {
    const notificationMessageObj = JSON.parse(messageObj.Records[0].Sns.Message);
    const timeSlot = getTimeSlotFromDateStr(notificationMessageObj.sendTimeUtc);
    const userId = notificationMessageObj.uniqueProperties.userId;
    const messageId = notificationMessageObj.uniqueProperties.messageId;

    if (timeSlot === null || !/^\d{2}-\d{2}$/.test(timeSlot)) {
        const errorMessage = `Invalid timeSlot: timeSlot=${timeSlot}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }

    if (userId === null) {
        const errorMessage = `Invalid userId: userId=${userId}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }

    if (messageId === null) {
        const errorMessage = `Invalid messageId: messageId=${messageId}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }

    return { timeSlot, userId, messageId };
}

module.exports.readNotificationFromS3 = async function(timeSlot, userId, messageId) {
    const s3db = new S3DB(config.NOTIFICATION_BUCKET, 'notifications/slots');
    const subPath = `${timeSlot}/${userId}-${messageId}.json`;
    const notification = await s3db.get(
        subPath,
        { returnNullIfNotFound: true });
    logger.debug(`Read notification from S3: ${notification ? JSON.stringify(notification, null, 2) : 'null'}`);
    return notification;
}
