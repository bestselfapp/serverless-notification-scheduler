# docker environment for development
FROM node:16-alpine as npmbuild

WORKDIR /opt/node_app

COPY package.json package-lock.json ./

#RUN npm install --no-optional && npm cache clean --force
# the above line was messing up the runtime for some reason
ARG GITHUB_TOKEN
RUN echo "//npm.pkg.github.com/:_authToken=$GITHUB_TOKEN" > .npmrc && \
    npm install && \
    rm -f .npmrc

# to see why this is a multi-stage build, see:
# https://www.alexandraulsh.com/2018/06/25/docker-npmrc-security
FROM node:16-alpine as devenv

COPY --from=npmbuild /opt/node_app /opt/node_app

ENV PATH /opt/node_app/node_modules/.bin:$PATH

# install serverless framework
RUN npm install -g serverless

WORKDIR /opt/node_app/app

ADD . .

RUN apk add --no-cache make

#ENTRYPOINT ["node", "index.js"]
ENTRYPOINT ["make"]
