# Serverless Notification Scheduler

A lightweight, cost-effective solution for scheduling and sending SMS and push notifications via AWS. It leverages Twilio as the backend service for sending SMS messages. Simply post a JSON request to an SNS topic, and let the service handle the rest. It's perfect for both immediate and recurring messages, with the latter easily configured through a single idempotent JSON request. The system supports dynamic, custom messages via callback URLs, allowing for real-time content updates. Built entirely on serverless AWS components like SNS, EventBridge, Lambda, and S3, it's not just efficient but also incredibly economical.  Your AWS bill for using this service, even at some scale should be approximately $0.05 per month, lol.  Twilio SMS charges are another story.

There are 3 microservices within this repo which make up this service, which are [described below](#understanding-the-microservices).

## Origins and Open-Sourcing

This functionality was originally developed as part of a larger project, BestSelfApp, a mobile application in the wellness and personal development space. The app required a feature to send daily reminder notifications to users, prompting them to complete their daily data entry, supporting either push notifications or SMS.  The notification functionality was built in a way that was not directly connected to the BestSelfApp, making it versatile enough to be used by any application that needs to send recurring or scheduled notifications. Recognizing its potential for broader use, I decided to open source it.

Please note that while the functionality is ready for use, it isn't completely tailored for open source. There are some variable names and S3 bucket names that include 'BSA' (for BestSelfApp) in the serverless.yml files. If you wish to use this functionality, you would need to provide new bucket names in the serverless.yml files. Aside from these minor changes, the functionality should be easy to use.

## Example Request

Below is a sample JSON request that can be dispatched to the SNS topic, triggering the Notification Services to process the request.  This is the only interface to this service.  All the settings to create, modify, and remove a recurring or time specified notification are managed by posting an SNS request in this JSON format.

```json
{
    "uniqueProperties": {
        "userId": "12345",
        "messageId": "dailyReminder"
    },
    "message": {
        "title": "",
        "subtitle": "",
        "body": "Here's your daily reminder to enter today's data!",
        "messageContentCallbackUrl": "https://api.bestselfapp.xyz/v1/callbacks/notificationMessage/12345"
    },
    "scheduleType": "recurring",
    "notificationType": "sms",
    "pushNotificationSettings": {
        "appleSettings": {
            "deviceToken": "future implementation",
            "credentials": "future implementation"
        }
    },
    "smsNotificationSettings": {
        "phoneNumber": "6095551212"
    },
    "sendTimeUtc": "2024-01-02T02:00:00Z",
    "enableAdaptiveTiming": false,
    "adaptiveTimingCallbackUrl": "https://api.bestselfapp.xyz/v1/callbacks/notificationTiming/12345"
}
```

## Field Descriptions

The JSON example above contains several fields. Below, each field is explained in more detail to provide a better understanding of their purpose and usage.

`uniqueProperties` - This field is crucial for uniquely identifying a message within the system. It consists of two parts:

- `userId`: This is the identifier for the user who will receive the message. It should be a unique identifier from your system, such as a user ID or username.

- `messageId`: This is a short string that uniquely identifies the type of message being sent. For example, if your app sends a daily reminder to users, you might use "dailyReminder" as the `messageId`. If the message is a welcome message sent when a user first enables SMS notifications, you could use "welcomeMessage" as the `messageId`.

Together, the `userId` and `messageId` form a unique key that represents a specific message for a specific user within the system. This allows the system to track each message and ensure that it is delivered correctly.

`message` - This field contains the content of the notification message. It's designed to handle both SMS and push notifications, depending on the user's preference. It has four sub-fields:

- `title`: This is the title of the notification. It's primarily used for push notifications on iOS and Android devices, where it will be displayed as the heading. For SMS notifications, the `title` field is not used.

- `subtitle`: This is a secondary line of text that provides additional information about the notification. It's only used for push notifications on iOS and Android devices. For SMS notifications, the `subtitle` field is not used.

- `body`: This is the main content of the notification. It will be displayed as the body of the push notification on iOS and Android devices. For SMS notifications, it will be included as the main text of the message.

- `messageContentCallbackUrl` (optional): This is a URL that the system will call to retrieve the final content of the message just before it is sent. This allows the content of the message to be dynamic and change based on the current state of your application. The system expects the URL to return a JSON object with `title`, `subtitle`, and `body` fields. If this field is not provided, the system will use the `title`, `subtitle`, and `body` fields as they are.

Even though some fields are only used for push notifications, it's recommended to provide all fields in case the user switches their preference from SMS to push notifications or vice versa. The system will automatically use the appropriate fields based on the notification type.

`scheduleType` - This field determines the scheduling behavior of the notification. It accepts two possible values:

- `recurring`: If this value is set, the notification will be sent on a recurring schedule. The frequency of the recurrence is determined by other fields in the JSON request.

- `one-time`: If this value is set, the notification will be sent only once at a specified time.

`notificationType` - This field specifies the type of notification to be sent. It accepts three possible values:

- `sms`: If this value is set, the notification will be sent as an SMS message to the phone number specified in the `smsNotificationSettings` field.

- `push`: If this value is set, the notification will be sent as a push notification to the device specified in the `pushNotificationSettings` field.

- `none`: If this value is set, no notification will be sent. This can be used to cancel a previously scheduled notification.

`pushNotificationSettings` - This field is intended for future use to support push notifications. It is not currently implemented and the system only supports SMS notifications at this time. They are placeholders for future functionality.

`smsNotificationSettings` - This field contains the settings for SMS notifications. It has one sub-field:

- `phoneNumber`: This is the phone number to which the SMS notification will be sent.

`sendTimeUtc` - This field specifies the time when the notification should be sent. It accepts two types of values:

- `now`: If this value is set, the notification will be sent as soon as possible, typically within the next minute.

- A UTC timestamp: If a specific date and time is provided, the notification will be scheduled to be sent at that time. The timestamp should be in the format "YYYY-MM-DDTHH:MM:SSZ". The system will round the provided timestamp to the next nearest 5-minute mark. For example, if "2024-01-02T02:03:00Z" is provided, it will be rounded to "2024-01-02T02:05:00Z". Please note that the system only processes scheduled notifications every five minutes. To ensure your notification is sent at the desired time, it's recommended to round the timestamp to the nearest 5 minutes yourself.

`enableAdaptiveTiming` - This field is a placeholder for future functionality. When implemented, it will allow the system to adjust the timing of recurring notifications based on user behavior. If set to `true`, the system will call the `adaptiveTimingCallbackUrl` to determine the optimal time to send the notification. Currently, this functionality is not implemented and this field has no effect.

`adaptiveTimingCallbackUrl` - This field is a placeholder for future functionality. When the `enableAdaptiveTiming` feature is implemented, this URL will be called by the system to determine the optimal time to send the notification. The system will expect the URL to return a JSON object with a `bestTimeToSend` field containing a UTC timestamp. This allows the system to adjust the notification timing to when users are most likely to be using the application, even if the notification was originally scheduled for a different time. Currently, this functionality is not implemented and this field has no effect.

## Required SSM Parameters

These are the paths that must exist in your AWS account's Systems Manager Parameter Store for the Notification Services solution to function properly:

- `/bsa/TWILIO_ACCOUNT_SID`: This is your Twilio Account SID, which is used to authenticate requests made to the Twilio API for sending SMS messages.

- `/bsa/TWILIO_AUTH_TOKEN`: This is your Twilio Auth Token, which is used along with the Account SID to authenticate requests made to the Twilio API.

- `/bsa/TWILIO_FROM_NUMBER`: This is the phone number from which SMS messages will be sent. This number must be a valid Twilio phone number associated with your account.

- `/bsa/secrets/callbacks_apikey`: This is the API key that will be sent in the header of any requests made to the callback URLs specified in your JSON requests. This allows the system to authenticate itself when requesting dynamic content for your notifications.

## Understanding the Microservices

In this section, we delve into the functionality of each of the three microservices, providing a clear overview of their roles within the system.

### Notification Scheduler Service (SNS -> Lambda)

The Notification Scheduler Service serves as the primary point of interaction with the system. It is responsible for receiving and processing notification configuration requests. These requests are handled idempotently, meaning you can send the same request multiple times without creating duplicate notifications.

Upon receiving a request, the service stores the notification configuration in an S3 bucket. The path structure indicates the time slot for when the notification is intended to be sent. The time slot is represented in "hh-mm" format (UTC), corresponding to the hour and minute the user wants the notification to be sent.

The service ensures that each notification, identified by a unique UID, exists only in a single time slot. This unique UID corresponds to the `userId-messageId` property in the JSON structure above. The notification configuration is stored in the following S3 path: `s3://{yourNotificationsBucket}/notifications/slots/{hh-mm}/{userId-messageId}.json`.

### Notification Submitter Service (EventBridge cron every minute -> Lambda)

The Notification Submitter Service is a Lambda function that runs every minute, triggered by an EventBridge cron job. It scans the S3 bucket for notifications scheduled for the current time slot and sends them for processing by posting them to an SNS topic, which triggers another Lambda function.

There are two types of notifications this service handles:

- Notifications with `sendTimeUtc` set to `now`: These notifications are processed every minute when the cron job runs.

- Notifications with `sendTimeUtc` set to a specific date and time: These notifications are processed only at five-minute intervals that are evenly divisible by 5 (e.g., 00:05, 00:10, 00:15, etc.).

After a one-time notification has been processed, the service deletes the corresponding file from the S3 bucket to prevent it from being sent again.

## Notification Processor Service (SNS -> Lambda)

Receives the SNS messages from the Submitter Service and immediately sends the actual notification via Twilio, iOS, or Android.

The service maintains a comprehensive log of all messages sent to the user, appending each entry to a file in an S3 bucket. This log includes the `notificationType` (SMS or push), the content of the message, and the timestamp of when the message was sent.
