# The Crucible — adversarial AI environment for high-stakes thinking.
#
# Single stage: zero runtime dependencies, so there is nothing to install —
# just Node 20 and the source. The ledger lives on the /data volume so your
# record of how your thinking evolved survives container restarts; it is the
# whole point of the system.

FROM node:20-slim
WORKDIR /app

COPY package.json ./
COPY src/ src/

ENV CRUCIBLE_LEDGER_DIR=/data/ledger \
    PORT=4517
VOLUME /data
EXPOSE 4517

CMD ["node", "src/server.js"]
