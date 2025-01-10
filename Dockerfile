FROM node:20-alpine AS build
WORKDIR /source
COPY package.json package-lock.json ./
COPY . .
RUN npm ci
RUN npm run build

FROM node:20-alpine AS runner
RUN apk --no-cache add aws-cli
COPY --from=build /source/dist ./dist
COPY --from=build /source/package.json /source/package-lock.json ./
RUN npm ci
RUN npm install -g .
VOLUME [ "/data" ]

ENV STAGING_DIR=/data
ENTRYPOINT ["s3-sync"]