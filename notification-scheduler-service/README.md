# Notification Scheduler Service (SNS -> Lambda)

* This service should not be coupled at all with the rest of BSA, its interface should require all information to be passed to it from BSA or any other calling system in order to send the notifications (including the delivery information) being sent with each request.
* This service should process these requests idempotently
* It should support single use messages and recurring messages, as well as allowing either of these message types to be sent immediately or at a future time / recurring time.
* Recurring messages should support overriding the default message content via a dynamic callback URL just before sending the message. This is to enable different content in notifications such as "You're on a data entry streak - 5 days in a row!" or "You missed the last 3 days, it's not too late to jump back in!", via CallbackURL for message body. If not provided or if the callback doesn't work, it will default to messageTitle, etc. Example callback URL: api.bsa.xyz/v1/callbacks/notificationMessage/:userId, which would return a JSON supporting overriding one or more of { title, subtitle, body }. (this route will be protected with a global API key rather than the per user Google token because we don't want to deal with permanent persisting tokens of various auth providers here)
* Puts the notification request in an S3 structure by time slot when the notification is intended to be sent, with all notifications info, it should support sending messages in minute increments, notated by "hh-mm", for the hour and minute to send (UTC, users local time is expected to be converted to UTC on the client end), the notification is placed in the s3 structure for each time slot (hh-mm) of the day according to when that user wants the notifications. It will need to ensure that the notification (the unique UID) exists only in a single slot. (s3://bsa-pdata-dev-us-east-1/notifications/slots/{hh-mm}/{notificationUID}.json

Good example reference for iOS push notifications payload:
https://tanaschita.com/20230417-cheatsheet-for-anatomy-of-ios-push-notifications/

## Build

The build requires the Github Token so it has access to pull the private npm repos from Github Packages.  This token is passed into the docker build via the `--build-arg GITHUB_TOKEN` below.  This token is generated in Github via [this guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages) (when generating for the first time).  If you already have your token it will be in your `~/npmrc` file, see:

```
# //npm.pkg.github.com/:_authToken=(this is where GITHUB_TOKEN should be)
```

```shell
# assuming the first line of your ~/.npmrc is used for npm.pkg.github.com,
# this will work to grab it:
export GITHUB_TOKEN=$(head -1 ~/.npmrc | cut -d= -f 2)
docker build --build-arg GITHUB_TOKEN -t bestselfapp/notification-scheduler:latest .
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
    bestselfapp/notification-scheduler:latest slsdeploy
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
    bestselfapp/notification-scheduler:latest slsinvokelocal
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
    bestselfapp/notification-scheduler:latest test
```

