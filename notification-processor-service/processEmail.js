// processEmail.js

const config = require('./config');
const S3DB = require('@dwkerwin/s3db');
const createLogger = require('./logger');
let logger = createLogger();
const nodemailer = require('nodemailer');
const path = require('path');
const ejs = require('ejs');

let transporter;

// Initialize the transporter based on the EMAIL_PROVIDER
if (config.EMAIL_PROVIDER === 'MAILGUN') {
  const mailgunTransport = require('nodemailer-mailgun-transport');

  if (!config.MAILGUN_API_KEY || !config.MAILGUN_DOMAIN) {
    throw new Error('Mailgun API key and domain must be provided.');
  }

  const apiKeyLength = config.MAILGUN_API_KEY.length;
  const apiKeyLastFour = config.MAILGUN_API_KEY.slice(-4);
  logger.info(
    `Initializing Mailgun transporter with API key of length ${apiKeyLength} and ending with '${apiKeyLastFour}'`,
    { correlationId: logger.correlationId }
  );
  logger.info(`Using Mailgun domain: ${config.MAILGUN_DOMAIN}`, { correlationId: logger.correlationId });

  transporter = nodemailer.createTransport(
    mailgunTransport({
      auth: {
        api_key: config.MAILGUN_API_KEY,
        domain: config.MAILGUN_DOMAIN,
      },
    })
  );

  logger.info(`Email provider set to Mailgun`, { correlationId: logger.correlationId });
} else if (config.EMAIL_PROVIDER === 'SES') {
  const aws = require('aws-sdk');
  aws.config.update({ region: config.AWS_REGION });
  const ses = new aws.SES({ apiVersion: '2010-12-01' });

  transporter = nodemailer.createTransport({
    SES: ses,
  });

  logger.info(`Email provider set to AWS SES`, { correlationId: logger.correlationId });
} else {
  throw new Error(`Unsupported EMAIL_PROVIDER: ${config.EMAIL_PROVIDER}`);
}

async function sendMessage(event) {
  // the message is split into parts for push notifications, combine
  // it here for email
  const s3uri = event.message.body;
  if (!s3uri.startsWith('s3://')) {
    const errMsg = `Invalid S3 key: ${s3uri}. For email this should always start with 's3://'.`;
    logger.error(errMsg, { correlationId: logger.correlationId });
    throw new Error(errMsg);
  }

  // s3uri format: s3://bucket-name/path/to/file
  const parts = s3uri.split('/');
  const parsedBucket = parts[2];
  const parsedPath = parts.slice(3).join('/');
  logger.info(
    `Sending Email to ${event.emailNotificationSettings.toEmailAddress}, body from s3://${parsedBucket}/${parsedPath}`,
    { correlationId: logger.correlationId }
  );

  let mailOptions;
  let attachments = []; // Declare attachments here
  let emailContent;     // Declare emailContent here

  try {
    const s3db = new S3DB(parsedBucket, parsedPath);
    const items = await s3db.list();

    // Check if the 'index.html' file exists in the S3 path
    if (!items.includes('index.html')) {
      const errMsg = `Missing index.html file in ${s3uri}`;
      logger.error(errMsg, { correlationId: logger.correlationId });
      throw new Error(errMsg);
    }

    // Loop through each key in the S3 path
    for (const item of items) {
      logger.info(`Fetching ${item}`, { correlationId: logger.correlationId });
      const blob = await s3db.getBlob(item, { returnNullIfNotFound: true });
      if (!blob) {
        const errMsg = `Missing blob for ${item} in ${s3uri}`;
        logger.error(errMsg, { correlationId: logger.correlationId });
        throw new Error(errMsg);
      }
      const fullKey = path.join(parsedPath, item);
      logger.trace(`Adding ${fullKey} as an attachment`, { correlationId: logger.correlationId });

      if (fullKey === path.join(parsedPath, 'index.html')) {
        // If the blob is 'index.html', use its content as the email body
        emailContent = blob.toString('utf-8');
        logger.debug('Email content fetched from S3', { correlationId: logger.correlationId });
      } else {
        // Use the blob directly as a Buffer
        attachments.push({
          filename: item,
          content: blob,
          cid: item,
        });
      }
    }

    // Check if emailContent has a value
    if (!emailContent) {
      const errMsg = 'No email content found in the S3 bucket';
      logger.error(errMsg, { correlationId: logger.correlationId });
      throw new Error(errMsg);
    }

    // Process the email content as an EJS template
    const templateData = {
      unsubscribeUrl: event.emailNotificationSettings.unsubscribeUrl || '',
    };

    try {
      emailContent = ejs.render(emailContent, templateData);
      logger.debug('Email content rendered using EJS', { correlationId: logger.correlationId });
    } catch (err) {
      const errMsg = `Error rendering email template: ${err}`;
      logger.error(errMsg, { correlationId: logger.correlationId });
      throw new Error(errMsg);
    }
  } catch (err) {
    const errMsg = `Error preparing to send Email to ${event.emailNotificationSettings.toEmailAddress}: ${err}`;
    logger.error(errMsg, { correlationId: logger.correlationId });
    throw err;
  }

  // Build the mail options
  mailOptions = {
    from: event.emailNotificationSettings.fromEmailAddress,
    to: event.emailNotificationSettings.toEmailAddress,
    subject: event.message.title,
    html: emailContent,
    attachments: attachments,
    headers: event.emailNotificationSettings.unsubscribeUrl
      ? {
          'List-Unsubscribe': `<${event.emailNotificationSettings.unsubscribeUrl}>`,
        }
      : {},
  };

  // Log mail options for debugging (exclude sensitive content)
  try {
    const sanitizedMailOptions = {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      headers: mailOptions.headers,
      attachments: mailOptions.attachments.map((attachment) => ({
        filename: attachment.filename,
        cid: attachment.cid,
        contentLength: attachment.content.length,
      })),
    };
    logger.debug(`Mail options: ${JSON.stringify(sanitizedMailOptions)}`, { correlationId: logger.correlationId });
  } catch (err) {
    logger.error(`Error while sanitizing mail options for logging: ${err}`, { correlationId: logger.correlationId });
  }

  // Send the email using the transporter
  let info;
  try {
    info = await transporter.sendMail(mailOptions);
  } catch (error) {
    logger.error(`Error sending Email to ${mailOptions.to}: ${error.message}`, { correlationId: logger.correlationId });
    if (error.response && error.response.body) {
      logger.error(`Mailgun error response: ${JSON.stringify(error.response.body)}`, { correlationId: logger.correlationId });
    }
    throw error;
  }

  // Adjust messageId extraction based on provider
  let messageId;
  if (config.EMAIL_PROVIDER === 'MAILGUN') {
    messageId = info.id;
  } else if (config.EMAIL_PROVIDER === 'SES') {
    messageId = info.messageId;
  }

  // Continue with the rest of your logging and processing
  if (!messageId) {
    const errMsg = `No messageId returned when sending Email to ${mailOptions.to}`;
    logger.error(errMsg, { correlationId: logger.correlationId });
    throw new Error(errMsg);
  } else {
    logger.info(`Email sent to ${mailOptions.to}, messageId: ${messageId}`, { correlationId: logger.correlationId });

    // Log additional response information if available
    if (info.response) {
      logger.debug(`Email provider response: ${info.response}`, { correlationId: logger.correlationId });
    }
  }

  return true;
}

module.exports = sendMessage;
