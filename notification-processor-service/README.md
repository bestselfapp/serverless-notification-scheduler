# Notification Processor Service (SNS -> Lambda)

A NotificationProcessor receives the notification submitter messages and sends the notification.

Log (append) all messages sent to the user in S3, store notificationType (SMS, push), the message, and the time.

Adaptive message and adaptive timing need to be applied here, not in the scheduler service.

## Build

The build requires the Github Token so it has access to pull the private npm repos from Github Packages.  This token is passed into the docker build via the `--build-arg GITHUB_TOKEN` below.  This token is generated in Github via [this guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages) (when generating for the first time).  If you already have your token it will be in your `~/npmrc` file, see:

```
# //npm.pkg.github.com/:_authToken=(this is where GITHUB_TOKEN should be)
```

```shell
# assuming the first line of your ~/.npmrc is used for npm.pkg.github.com,
# this will work to grab it:
export GITHUB_TOKEN=$(head -1 ~/.npmrc | cut -d= -f 2)
docker build --build-arg GITHUB_TOKEN -t bestselfapp/notification-processor:latest .
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
    bestselfapp/notification-processor:latest slsdeploy
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
    bestselfapp/notification-processor:latest slsinvokelocal
```
