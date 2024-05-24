const TwilioSmsPlus = require('twilio-sms-plus');
const config = require('./config');
const createLogger = require('./logger');
let logger = createLogger();

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
        const isOptedOut = await twilioPlus.isOptedOut(params.toPhoneNumber);
        if (isOptedOut) {
            logger.warn(`Phone number ${params.toPhoneNumber} has opted out of SMS notifications, will not send.`);
            // call the callbackURL at event.smsNotificationSettings.unsubscribeCallbackUrl
            // with the phone number as a parameter
            if (event.smsNotificationSettings.unsubscribeCallbackUrl) {
                try {
                    const response = await axios.post(event.smsNotificationSettings.unsubscribeCallbackUrl);
                    logger.info('Unsubscribe callback successful:', response.data);
                } catch (error) {
                    logger.error('Error during unsubscribe callback:', error);
                }
            }
            return true;
        }
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
