FROM node:22

WORKDIR /app

# Copy all source files
COPY . .

# Install all deps and build React
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
