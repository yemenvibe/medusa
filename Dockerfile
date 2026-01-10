# --------------------------------------------------
# 1️⃣ BUILD STAGE
# --------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /server

RUN apk add --no-cache python3 make g++
COPY .yarn .yarn
COPY .yarnrc.yml ./
COPY package.json yarn.lock ./

RUN corepack enable && yarn install --immutable
COPY . .

RUN if [ -f tsconfig.json ]; then yarn build; else echo "No build step (JavaScript project)"; fi
RUN yarn medusa build

# ✅ Transpile medusa-config.ts to JS
RUN node -e "const fs=require('fs');let ts;try{ts=require('typescript');}catch(e){ts=null;}const src='medusa-config.ts';if(ts&&fs.existsSync(src)){const source=fs.readFileSync(src,'utf8');const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}});fs.writeFileSync('medusa-config.js',result.outputText);}else{fs.writeFileSync('medusa-config.js','');}"

# ✅ Copy admin build output to runtime location expected by medusa start
RUN if [ -d ".medusa/server/public/admin" ]; then mkdir -p public && cp -r .medusa/server/public/admin public/; fi

RUN mkdir -p .medusa static

# --------------------------------------------------
# 2️⃣ RUNNER STAGE
# --------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /server

COPY --from=builder /server/.yarn ./.yarn
COPY --from=builder /server/.yarnrc.yml ./
COPY --from=builder /server/package.json ./
COPY --from=builder /server/yarn.lock ./
COPY --from=builder /server/tsconfig*.json ./
COPY --from=builder /server/.medusa ./.medusa
# COPY --from=builder /server/dist ./dist || true
COPY --from=builder /server/node_modules ./node_modules

COPY --from=builder /server/static ./static
COPY --from=builder /server/public ./public
COPY --from=builder /server/medusa-config.js ./medusa-config.js
COPY --from=builder /server/src ./src
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

RUN corepack enable && yarn install --immutable

ENV NODE_ENV=production
EXPOSE 9000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npx", "medusa", "start"]
