const logger = require('./logger')

class TwilioSmsPlus {
  constructor(config) {
    this.twilioAccountSid = config.twilioAccountSid
    this.twilioAuthToken = config.twilioAuthToken
  }

  async sendTextMessage(params) {
    logger.info(`Texting ${params.textMessage.length} chars message to ${params.toPhoneNumber} ...`)

    const twilio = require('twilio')(this.twilioAccountSid, this.twilioAuthToken);
    const PNF = require('google-libphonenumber').PhoneNumberFormat;
    const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

    let fromNumber = null
    let fromNumberE164 = null
    try {
      fromNumber = phoneUtil.parseAndKeepRawInput(params.fromPhoneNumber, 'US');
      fromNumberE164 = phoneUtil.format(fromNumber, PNF.E164)
    }
    catch (err) {
      logger.error(`Error converting fromPhoneNumber ${params.fromPhoneNumber} to E164 format:`, err)
      return { success: false }
    }
    logger.trace(`Converted source phone number ${params.fromPhoneNumber} to E164 format: ${fromNumberE164}`)

    let toNumber = null
    let toNumberE164 = null
    try {
      toNumber = phoneUtil.parseAndKeepRawInput(params.toPhoneNumber, 'US');
      toNumberE164 = phoneUtil.format(toNumber, PNF.E164)
    }
    catch (err) {
      logger.error(`Error converting toPhoneNumber ${params.toPhoneNumber} to E164 format:`, err)
      return { success: false }
    }
    logger.debug(`Converted target phone number ${params.toPhoneNumber} to E164 format: ${toNumberE164}`)

    let message
    try {
      message = await twilio.messages
      .create({
         body: params.textMessage,
         from: fromNumberE164,
         to: toNumberE164
       })
    }
    catch (err) {
      // https://www.twilio.com/docs/api/errors
      if (err.code == 21211) {
        logger.warn(`Invalid target phone number given (${params.toPhoneNumber}). `, err)
        return { success: false }
      } else {
        logger.error(`Error sending Twilio message to ${toNumberE164}.`, err)
        throw err
      }
    }
    logger.info(`Twilio message sid: ${message.sid}`)

    return { success: true, twilioMessageSid: message.sid }
  }
}

module.exports = TwilioSmsPlus;
