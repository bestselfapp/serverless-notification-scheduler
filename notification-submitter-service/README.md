# Notification Submitter Service (EventBridge cron every minute -> Lambda)

A NotificationSubmitter Lambda function runs on a cron every minute. It finds all notifications in the S3 structure specified under the current timeslot it is processing and sends them for Notification Processing by posting them to SNS->Lambda. 

There are two types of notifications this service handles:

- Notifications with `sendTimeUtc` set to `now`: These notifications are processed every minute when the cron job runs.

- Notifications with `sendTimeUtc` set to a specific date and time: These notifications are processed only at five-minute intervals that are evenly divisible by 5 (e.g., 00:05, 00:10, 00:15, etc.).

If the message is one-time, this service will delete the message from the time slot in S3.

## Build

```shell
docker build -t notification-submitter:latest .
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
    notification-submitter:latest slsdeploy
```

## Run Locally Via Sls

Relies on local ~/.aws/ credentials, see the README in the infrastructure repo for the list of required profiles.

```shell
export AWS_ENV="dev" && export PROFILE="bsa$AWS_ENV"
export EVENTPATH="events/cronEventWithNotifications.json"
docker run -it -p 80:8080 \
    -v $(pwd):/opt/node_app/app \
    -v ~/.aws/:/root/.aws/ \
    -e AWS_ENV -e AWS_PROFILE=$PROFILE -e EVENTPATH \
    --env-file env-dev.env \
    notification-submitter:latest slsinvokelocal
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
    notification-submitter:latest test
```

OR test from local:

```shell
set -a; source env-dev.env; set +a
sls invoke test
```

