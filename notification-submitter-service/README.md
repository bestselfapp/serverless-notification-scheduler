# Notification Processor Service (EventBridge cron every 5 mins -> Lambda)

A NotificaitonSubmitter lambda runs on a cron every five minutes, finds all notifications in the s3 structure specified under the current timeslot it is processing, and sends them for Notification Processing by posting them to SNS->Lambda. (similar to the batch-analysis-submitter)

If the message is one-time, this service will delete the message from the time slot in S3.

## Build

The build requires the Github Token so it has access to pull the private npm repos from Github Packages.  This token is passed into the docker build via the `--build-arg GITHUB_TOKEN` below.  This token is generated in Github via [this guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages) (when generating for the first time).  If you already have your token it will be in your `~/npmrc` file, see:

```
# //npm.pkg.github.com/:_authToken=(this is where GITHUB_TOKEN should be)
```

```shell
# assuming the first line of your ~/.npmrc is used for npm.pkg.github.com,
# this will work to grab it:
export GITHUB_TOKEN=$(head -1 ~/.npmrc | cut -d= -f 2)
docker build --build-arg GITHUB_TOKEN -t bestselfapp/notification-submitter:latest .
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
    bestselfapp/notification-submitter:latest slsdeploy
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
    bestselfapp/notification-submitter:latest slsinvokelocal
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
    bestselfapp/notification-submitter:latest test
```

OR test from local:

```shell
set -a; source env-dev.env; set +a
sls invoke test
```

