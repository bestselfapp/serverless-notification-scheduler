const config = {
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
    NOTIFICATION_BUCKET: process.env.NOTIFICATION_BUCKET,
  }
  
  module.exports = config
  