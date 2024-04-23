const config = {
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
    NOTIFICATION_BUCKET: process.env.NOTIFICATION_BUCKET,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
    BSA_CALLBACKS_APIKEY: process.env.BSA_CALLBACKS_APIKEY,
    MAX_NOTIFICATIONS_PER_HOUR: process.env.MAX_NOTIFICATIONS_PER_HOUR,
    MAX_NOTIFICATIONS_PER_DAY: process.env.MAX_NOTIFICATIONS_PER_DAY,
  }
  
  module.exports = config
  