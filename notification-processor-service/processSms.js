const TwilioSmsPlus = require('./twilioSmsPlus');
const config = require('./config');
const logger = require('./logger');

async function sendMessage(event) {
    // the message is split into parts for push notifications, combine
    // it here for SMS
    const messageText = `${event.message.title} - ${event.message.body}`;

    logger.info(`Sending SMS to ${event.smsNotificationSettings.phoneNumber}: ${messageText}`);

    try {
        const params = {
            textMessage: messageText,
            toPhoneNumber: event.smsNotificationSettings.phoneNumber,
            fromPhoneNumber: config.TWILIO_FROM_NUMBER,
        };
        
        const twilioPlus = new TwilioSmsPlus({
            twilioAccountSide: config.TWILIO_ACCOUNT_SID,
            twilioAuthToken: config.TWILIO_AUTH_TOKEN
        });
        const result = await twilioPlus.sendTextMessage(params);
    }
    catch (err) {
        const errMsg = `Error sending SMS to ${event.smsNotificationSettings.phoneNumber}: ${err}`;
        logger.error(errMsg);
        throw err;
    }

    return true;
}

module.exports = sendMessage;
