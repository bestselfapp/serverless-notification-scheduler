# this Makefile intended to run inside the container

# default
slsinvokelocal:
	sls invoke local -f bsa-notification-scheduler -p ${EVENTPATH}

slsdeploy:
	sls deploy --verbose

slshardredeploy:
	sls remove
	sls deploy --verbose

.PHONY: test
test:
	sls invoke test
