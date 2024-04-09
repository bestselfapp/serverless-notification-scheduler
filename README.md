# Notification Services

See the README's in each subservice for more info.

## Notification Scheduler Service (SNS -> Lambda)

The front door.  This is where you configure notifications idempotently.  Stores notification configuration on S3 in a path structure that indicates the time slot.

## Notification Processor Service (EventBridge cron every 5 mins -> Lambda)

A NotificaitonSubmitter lambda runs on a cron every five minutes, finds all notifications in the s3 structure specified under the current timeslot it is processing, and sends them for Notification Processing by posting them to SNS->Lambda. (similar to the batch-analysis-submitter)

## Notification Processor Service (SNS -> Lambda)

A NotificationProcessor receives the notification submitter messages and sends the notification.

## Outstanding

Misc todo:

* Send a welcome message:
(what will prompt sending this?)
BestSelfApp - Hi there, we'll use this phone number to send you reminders to log your daily goals and events data in the app.  If you ever change your mind you can update your settings in the app or reply here with STOP.

* Test links to jump to the app:
bestselfapp://main

* Process STOP requests

* Support notificationTypes: sms, push, NONE

## Twilio Info

Customer Profile
BU1d3bd45988a801364045b69077d4dfb8
https://console.twilio.com/us1/account/trust-hub/customer-profiles/BU1d3bd45988a801364045b69077d4dfb8/details

A2P Brand
BNcf8793da097c81b11befecc2cf1a4882
https://console.twilio.com/us1/develop/sms/regulatory-compliance/brands/BNcf8793da097c81b11befecc2cf1a4882

A2P Campaign
CMc5013b64edf76298974eb02a231fbc5d
https://console.twilio.com/us1/develop/sms/regulatory-compliance/brands/BNcf8793da097c81b11befecc2cf1a4882/connected-campaigns/CMc5013b64edf76298974eb02a231fbc5d
