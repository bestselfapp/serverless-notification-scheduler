const config = require('./config');
const S3DB = require('@dwkerwin/s3db');
const createLogger = require('./logger');
let logger = createLogger();
const nodemailer = require('nodemailer');
const sesTransport = require('nodemailer-ses-transport');
const path = require('path');

const transporter = nodemailer.createTransport(sesTransport({
    region: config.AWS_REGION
}));

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

        const mailOptions = {
            from: event.emailNotificationSettings.fromEmailAddress,
            to: event.emailNotificationSettings.toEmailAddress,
            subject: event.message.title,
            html: emailContent,
            attachments: attachments.map(attachment => ({
                filename: attachment.filename,
                content: Buffer.from(attachment.content, 'base64'),
                encoding: 'base64',
                cid: attachment.cid
            }))
        };

        // Create a sanitized copy of mailOptions for logging
        const sanitizedMailOptions = {
            ...mailOptions,
            attachments: mailOptions.attachments.map(attachment => ({
                filename: attachment.filename,
                encoding: attachment.encoding,
                cid: attachment.cid,
                content: `[BASE64 CONTENT OMITTED, length: ${attachment.content.length} characters]`
            }))
        };
        logger.trace(`Mail options: ${JSON.stringify(sanitizedMailOptions)}`);

        // Log SMTP Transport Configuration (excluding sensitive details)
        logger.trace(`SMTP Transport Config: ${JSON.stringify(transporter.options)}`);
        
        await new Promise((resolve, reject) => {
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    logger.error(`Error sending Email to ${mailOptions.to}: ${error}`);
                    reject(error);
                } else {
                    logger.debug(`Email SES response info: ${JSON.stringify(info, null, 2)}`);

                    if (!info || !info.messageId) {
                        const errMsg = `No messageId returned when sending Email to ${mailOptions.to}`;
                        logger.error(errMsg);
                        reject(new Error(errMsg));
                    } else {
                        logger.info(`Email sent to ${mailOptions.to}, messageId: ${info.messageId}`);

                        // Log raw SES response if available
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
                        }
                        catch (err) {
                            logger.error(`Error logging accepted, rejected, and pending recipients: ${err}`);
                        }

                        resolve();
                    }
                }
            });
        });
    }
    catch (err) {
        const errMsg = `Error sending Email to ${event.emailNotificationSettings.toEmailAddress}: ${err}`;
        logger.error(errMsg);
        throw err;
    }

    return true;
}

module.exports = sendMessage;
