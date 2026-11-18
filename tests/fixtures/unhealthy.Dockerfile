ARG APP_IMAGE
FROM ${APP_IMAGE}
LABEL org.opencontainers.image.revision="" \
    io.decisionwheel.validation="Unhealthy local recovery fixture; not a release image"
CMD ["node", "-e", "require('node:http').createServer((_request, response) => { response.writeHead(503); response.end(); }).listen(3000, '0.0.0.0')"]
