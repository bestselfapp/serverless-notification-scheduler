# Notification Processor Service (SNS -> Lambda)

Receives the SNS messages from the Submitter Service and immediately sends the actual notification via Twilio, iOS, or Android.

The service maintains a comprehensive log of all messages sent to the user, appending each entry to a file in an S3 bucket. This log includes the `notificationType` (SMS or push), the content of the message, and the timestamp of when the message was sent.

## Build

```shell
docker build -t notification-processor:latest .
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
    notification-processor:latest slsdeploy
```

## Run Locally Via Sls

Relies on local ~/.aws/ credentials, see the README in the infrastructure repo for the list of required profiles.

```shell
export AWS_ENV="dev" && export PROFILE="bsa$AWS_ENV"
export EVENTPATH="events/validSmsNotification.json"
docker run -it -p 80:8080 \
    -v $(pwd):/opt/node_app/app \
    -v ~/.aws/:/root/.aws/ \
    -e AWS_ENV -e AWS_PROFILE=$PROFILE -e EVENTPATH \
    --env-file env-dev.env --env-file env-secrets.env \
    notification-processor:latest slsinvokelocal
```

## Test

```shell
export AWS_ENV="dev" && export AWS_PROFILE="bsa$AWS_ENV"
# see local setup section above to create env-secrets.env file
docker run -it \
    -v $(pwd):/opt/node_app/app \
    -v ~/.aws/:/root/.aws/ \
    -e AWS_ENV -e AWS_PROFILE \
    --env-file env-dev.env --env-file env-secrets.env \
    notification-processor:latest test
```

OR test from local:

```shell
set -a; source env-dev.env; source env-secrets.env; set +a
sls invoke test
```
