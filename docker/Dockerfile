FROM node:24-alpine3.22

RUN echo "https://dl-cdn.alpinelinux.org/alpine/v3.22/community/" >> /etc/apk/repositories && \
    apk update && \
    apk add --no-cache openjdk21-jre-headless

ENV JAVA_HOME=/usr/lib/jvm/java-22-openjdk
ENV PATH="$JAVA_HOME/bin:$PATH"

RUN npm install -g firebase-tools

WORKDIR /app
COPY local/docker/database.rules.json /app/database.rules.json
COPY local/docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 4000 9000 9099
ENTRYPOINT ["/app/entrypoint.sh"]
