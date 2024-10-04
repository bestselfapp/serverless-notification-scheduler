const config = require('./config');
const S3DB = require('@dwkerwin/s3db');
const createLogger = require('./logger');
let logger = createLogger();
const nodemailer = require('nodemailer');
const aws = require('aws-sdk');
const path = require('path');

aws.config.update({ region: process.env.AWS_REGION });
const ses = new aws.SES({ apiVersion: '2010-12-01' });

// Create Nodemailer transporter using the built-in SES transport
const transporter = nodemailer.createTransport({
  SES: ses,
  logger: true,
  debug: true
});

async function sendMessage(event) {
    // the message is split into parts for push notifications, combine
    // it here for SMS
    const s3uri = event.message.body;
    if (!s3uri.startsWith('s3://')) {
        const errMsg = `Invalid S3 key: ${s3uri}. For email this should always start with 's3://'.`;
        logger.error(errMsg);
        throw new Error(errMsg);
    }

    // s3uri format: s3://bucket-name/path/to/file
    const parts = s3uri.split('/');
    const parsedBucket = parts[2];
    const parsedPath = parts.slice(3).join('/');
    logger.info(`Sending Email to ${event.emailNotificationSettings.toEmailAddress}, body from s3://${parsedBucket}/${parsedPath}`);

    let mailOptions;
    try {
        
        const s3db = new S3DB(parsedBucket, parsedPath);
        const items = await s3db.list();

        // Check if the 'index.html' file exists in the S3 bucket
        if (!items.includes('index.html')) {
            const errMsg = `Missing index.html file in ${s3uri}`;
            logger.error(errMsg);
            throw new Error(errMsg);
        }

        // Initialize an array to hold the attachments and a variable for the email content
        const attachments = [];
        let emailContent;

        // Loop through each key in the S3 bucket
        for (const item of items) {
            logger.info(`Fetching ${item}`);
            const blob = await s3db.getBlob(item, { returnNullIfNotFound: true });
            if (!blob) {
                const errMsg = `Missing blob for ${item} in ${s3uri}`;
                logger.error(errMsg);
                throw new Error(errMsg);
            }
            const fullKey = path.join(parsedPath,item);
            logger.trace(`Adding ${fullKey} as an attachment`);

            if (fullKey === path.join(parsedPath,'index.html')) {
                // If the blob is 'index.html', use its content as the email body
                emailContent = blob.toString('utf-8');
            } else {
                // Convert the blob to a base64 string
                const base64Data =  blob.toString('base64');

                // Add the base64 string to the attachments array
                attachments.push({
                    filename: item,
                    content: base64Data,
                    encoding: 'base64',
                    cid: item
                });
            }
        }

        // Check if emailContent has a value
        if (!emailContent) {
            const errMsg = 'No email content found in the S3 bucket';
            logger.error(errMsg);
            throw new Error(errMsg);
        }

        mailOptions = {
            from: event.emailNotificationSettings.fromEmailAddress,
            to: event.emailNotificationSettings.toEmailAddress,
            subject: event.message.title,
            html: emailContent,
            attachments: attachments.map(attachment => ({
              filename: attachment.filename,
              content: Buffer.from(attachment.content, 'base64'),
              cid: attachment.cid
              // 'encoding' is not needed here unless required
            }))
        };

        try {
            // Create a sanitized copy of mailOptions for logging
            const sanitizedMailOptions = {
              ...mailOptions,
              attachments: mailOptions.attachments.map(attachment => {
                const sanitizedAttachment = {
                  filename: attachment.filename || 'unknown',
                  cid: attachment.cid || 'unknown',
                  content: `[BASE64 CONTENT OMITTED, length: ${attachment.content ? attachment.content.length : 'unknown'} characters]`
                };
                // Only include 'encoding' if it exists
                if (attachment.encoding) {
                  sanitizedAttachment.encoding = attachment.encoding;
                }
                return sanitizedAttachment;
              })
            };
            logger.trace(`Mail options: ${JSON.stringify(sanitizedMailOptions)}`);
        } catch (err) {
            logger.error(`Error while sanitizing mail options for logging: ${err}`);
        }

        // Log SMTP Transport Configuration (excluding sensitive details)
        logger.trace(`SMTP Transport Config: ${JSON.stringify(transporter.options)}`);
    }
    catch (err) {
        const errMsg = `Error preparing to send Email to ${event.emailNotificationSettings.toEmailAddress}: ${err}`;
        logger.error(errMsg);
        throw err;
    }
    
    // Send the email using the transporter
    let info;
    try {
        info = await transporter.sendMail(mailOptions);
    } catch (error) {
        logger.error(`Error sending Email to ${mailOptions.to}: ${error}`);
        throw error;
    }

    // Sanitize the info object before logging
    try {
        const sanitizedInfo = { ...info };

        if (sanitizedInfo.raw) {
            // Replace raw data with indication of size
            if (Buffer.isBuffer(sanitizedInfo.raw)) {
            sanitizedInfo.raw = `[Buffer data omitted, length: ${sanitizedInfo.raw.length} bytes]`;
            } else if (typeof sanitizedInfo.raw === 'object' && sanitizedInfo.raw.type === 'Buffer' && Array.isArray(sanitizedInfo.raw.data)) {
            // For objects with type 'Buffer' and data array
            sanitizedInfo.raw = `[Buffer data omitted, length: ${sanitizedInfo.raw.data.length} bytes]`;
            } else {
            sanitizedInfo.raw = '[Raw data omitted]';
            }
        }

        logger.debug(`Email SES response info: ${JSON.stringify(sanitizedInfo, null, 2)}`);
    } catch (err) {
        logger.error(`Error while sanitizing email response info for logging: ${err}`);
    }

    // Continue with the rest of your logging and processing
    if (!info || !info.messageId) {
        const errMsg = `No messageId returned when sending Email to ${mailOptions.to}`;
        logger.error(errMsg);
        throw new Error(errMsg);
    } else {
        logger.info(`Email sent to ${mailOptions.to}, messageId: ${info.messageId}`);

        // Log additional SES response information if available
        if (info.response) {
            logger.debug(`SES response: ${info.response}`);
        }

        try {
            // Log accepted, rejected, and pending lists if they exist
            if (info.accepted && info.accepted.length > 0) {
            logger.trace(`Accepted recipients: ${info.accepted.join(', ')}`);
            }
            if (info.rejected && info.rejected.length > 0) {
            logger.trace(`Rejected recipients: ${info.rejected.join(', ')}`);
            }
            if (info.pending && info.pending.length > 0) {
            logger.trace(`Pending recipients: ${info.pending.join(', ')}`);
            }
        } catch (err) {
            logger.error(`Error logging accepted, rejected, and pending recipients: ${err}`);
        }
    }

    return true;
}

module.exports = sendMessage;
