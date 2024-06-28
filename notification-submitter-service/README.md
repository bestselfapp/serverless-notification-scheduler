# Notification Submitter Service (EventBridge cron every minute -> Lambda)

The Notification Submitter Lambda function is triggered by an EventBridge cron job every minute. Its primary role is to identify and process notifications scheduled for the current timeslot, posting them to an SNS topic for further processing by another Lambda function.

Notification Scheduling
Notifications are scheduled with a sendTimeUtc attribute specifying their intended send date and time. The service processes these notifications at five-minute intervals that are evenly divisible by 5 (e.g., 00:05, 00:10, 00:15, etc.).

Handling Off-Interval Send Times
In cases where a notification's sendTimeUtc does not align exactly with a 5-minute interval, the service employs a rounding strategy to determine the appropriate processing timeslot. Specifically, the send time is rounded to the nearest 5-minute interval. This approach ensures that each notification is processed in a timely manner, closest to its intended send time.

For example:

A notification scheduled for 12:03 UTC will be rounded and processed in the 12:05 UTC timeslot.
A notification scheduled for 12:07 UTC will be rounded and processed in the 12:05 UTC timeslot.
A notification scheduled for 12:08 UTC will be rounded and processed in the 12:10 UTC timeslot.

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

