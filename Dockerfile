FROM alpine:3.6

# Update
COPY . /src
RUN cd /src
RUN apk update && apk add --update nodejs nodejs-npm && npm install npm@latest -g
CMD ["node", "/src/app.js"]