FROM node:24
WORKDIR /usr/src/app
COPY package.json ./
COPY package-lock.json ./

RUN apt update
RUN apt install -y libsdl-pango-dev

RUN npm ci

COPY src ./src
COPY tsconfig.json ./
COPY .swcrc ./
COPY nodemon.json ./

RUN npm run build

EXPOSE 43594 43595
CMD [ "npm", "run", "start:standalone" ]
