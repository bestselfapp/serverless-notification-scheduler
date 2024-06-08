# Notification Scheduler Service (SNS -> Lambda)

The Notification Scheduler Service is the system's main interface, processing notification requests idempotently to avoid duplicates. It takes an SNS payload and triggers a Lambda function to handle each request, identified by a unique UID (`userId-messageId`). The requests are stored in an S3 bucket, with the storage path reflecting the desired notification time slot in "hh-mm" UTC format, ensuring each notification exists in only one time slot.

## Interface

The payload to the SNS topic for this service to schedule a notification is in the below format.  To delete a notification, use notificationType: 'none'.

```json
{
    "uniqueProperties": {
        "userId": "12345",
        "messageId": "dailyReminder"
    },
    "scheduleType": "recurring",
    "notificationType": "sms",
    "message": {
        "title": "BestSelfApp",
        "subtitle": "",
        "body": "Enter today's data!",
        "messageContentCallbackUrl": "https://api-dev.bestselfapp.xyz/v1/callbacks/notificationMessage/12345"
    },
    "pushNotificationSettings": {
        "appleSettings": {
            "deviceToken": "deviceTokenHere",
            "credentials": "notSureWhatGoesHere"
        }
    },
    "smsNotificationSettings": {
        "phoneNumber": "6092734392",
        "unsubscribeCallbackUrl": "https://api-dev.bestselfapp.xyz/v1/callbacks/unsubscribe/12345"
    },
    "emailNotificationSettings": {
        "toEmailAddress": "user@example.com",
        "fromEmailAddress": "noreply@bestselfapp.xyz",
        "unsubscribeUrl": "https://www.bestselfapp.xyz/unsubscribe/12345"
    },
    "sendTimeUtc": "2024-01-02T02:00:00Z",
    "enableAdaptiveTiming": true,
    "adaptiveTimingCallbackUrl": "https://api-dev.bestselfapp.xyz/v1/callbacks/adaptiveTiming/12345"
}

## Build

```shell
# assuming the first line of your ~/.npmrc is used for npm.pkg.github.com,
# this will work to grab it:
docker build -t notification-scheduler:latest .
```

Not working?  Try `npm i` locally first. ¯\_(ツ)_/¯

## Deploy

Relies on local ~/.aws/ credentials, see the README in the infrastructure repo for the list of required profiles.

```shell
export AWS_ENV="dev" && export PROFILE="bsa$AWS_ENV"
docker run -it \
    -v $(pwd):/opt/node_app/app \
    -v ~/.aws/:/root/.aws/ \
    -e AWS_ENV -e AWS_PROFILE=$PROFILE \
    notification-scheduler:latest slsdeploy
```

## Run Locally Via Sls

Relies on local ~/.aws/ credentials, see the README in the infrastructure repo for the list of required profiles.

```shell
export AWS_ENV="dev" && export PROFILE="bsa$AWS_ENV"
export EVENTPATH="events/validRecurringNotification.json"
docker run -it -p 80:8080 \
    -v $(pwd):/opt/node_app/app \
    -v ~/.aws/:/root/.aws/ \
    -e AWS_ENV -e AWS_PROFILE=$PROFILE -e EVENTPATH \
    --env-file env-dev.env \
    notification-scheduler:latest slsinvokelocal
```

## Test

```shell
export AWS_ENV="dev" && export AWS_PROFILE="bsa$AWS_ENV"
# see local setup section above to create env-secrets.env file
docker run -it \
    -v $(pwd):/opt/node_app/app \
    -v ~/.aws/:/root/.aws/ \
    -e AWS_ENV -e AWS_PROFILE \
    --env-file env-dev.env \
    notification-scheduler:latest test
```

OR test from local:

```shell
set -a; source env-dev.env; set +a
sls invoke test
```
