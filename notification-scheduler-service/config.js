const config = {
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
    NOTIFICATION_SCHEDULER_TOPIC_ARN: process.env.NOTIFICATION_SCHEDULER_TOPIC_ARN || 'arn:aws:sns:us-east-1:123456789012:notification-scheduler',
    NOTIFICATION_BUCKET: process.env.NOTIFICATION_BUCKET || 'bsa-pdata-dev-us-east-1',
  }
  
  module.exports = config
  