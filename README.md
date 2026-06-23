[<img alt="Spliit" height="60" src="https://github.com/spliit-app/spliit/blob/main/public/logo-with-text.png?raw=true" />](https://spliit.app)

Spliit is a free and open source alternative to Splitwise. You can either use the official instance at [Spliit.app](https://spliit.app), or deploy your own instance:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fspliit-app%2Fspliit&project-name=my-spliit-instance&repository-name=my-spliit-instance&stores=%5B%7B%22type%22%3A%22postgres%22%7D%5D&)

## Features

- [x] Create a group and share it with friends
- [x] Create expenses with description
- [x] Display group balances
- [x] Create reimbursement expenses
- [x] Progressive Web App
- [x] Select all/no participant for expenses
- [x] Split expenses unevenly [(#6)](https://github.com/spliit-app/spliit/issues/6)
- [x] Mark a group as favorite [(#29)](https://github.com/spliit-app/spliit/issues/29)
- [x] Tell the application who you are when opening a group [(#7)](https://github.com/spliit-app/spliit/issues/7)
- [x] Assign a category to expenses [(#35)](https://github.com/spliit-app/spliit/issues/35)
- [x] Search for expenses in a group [(#51)](https://github.com/spliit-app/spliit/issues/51)
- [x] Upload and attach images to expenses [(#63)](https://github.com/spliit-app/spliit/issues/63)
- [x] Create expense by scanning a receipt [(#23)](https://github.com/spliit-app/spliit/issues/23)

### Possible incoming features

- [ ] Ability to create recurring expenses [(#5)](https://github.com/spliit-app/spliit/issues/5)
- [ ] Import expenses from Splitwise [(#22)](https://github.com/spliit-app/spliit/issues/22)

## Stack

- [Vite](https://vite.dev/) + [React](https://react.dev/) for the web SPA
- [Hono](https://hono.dev/) + [tRPC](https://trpc.io/) for the API
- [TailwindCSS](https://tailwindcss.com/) for the styling
- [shadcn/UI](https://ui.shadcn.com/) for the UI components
- [Prisma](https://prisma.io) to access the database

## Contribute

The project is open to contributions. Feel free to open an issue or even a pull-request!
Join the discussion in [the Spliit Discord server](https://discord.gg/YSyVXbwvSY).

If you want to contribute financially and help us keep the application free and without ads, you can also:

- 💜 [Sponsor me (Sebastien)](https://github.com/sponsors/scastiel), or
- 💙 [Make a small one-time donation](https://donate.stripe.com/28o3eh96G7hH8k89Ba).

### Translation

The project's translations are managed using [our Weblate project](https://hosted.weblate.org/projects/spliit/spliit/).
You can easily add missing translations to the project or even add a new language!
Here is the current state of translation:

<a href="https://hosted.weblate.org/engage/spliit/">
<img src="https://hosted.weblate.org/widget/spliit/spliit/multi-auto.svg" alt="Translation status" />
</a>

## Run locally

1. Clone the repository (or fork it if you intend to contribute)
2. Run `bun install` to install dependencies.
3. Start a PostgreSQL server with `./scripts/start-local-db.sh`.
4. Copy the file `.env.example` as `.env`
5. Run prisma migrations and generate the client with `bun prisma-migrate` and `bun prisma-generate`
6. Run `bun dev` to start the web app at http://localhost:3000 and API at http://localhost:3001

## Run in a container

1. Copy the file `container.env.example` as `container.env`.
2. Set `POSTGRES_PASSWORD` to a long random value.
3. Set `WEB_ORIGINS` to the public web origin.
4. Run `bun start-container` to start the API and Postgres.

The API is available at http://localhost:3001. The database is only reachable on the internal Docker network and stores data in the `postgres_data` Docker volume.

For Dokploy on a single Hetzner VPS, publish only the `api` service as your API domain and keep the `db` service private. If the web app is hosted on Cloudflare Pages, set `VITE_API_URL` there to the public Dokploy API origin, for example `https://api.spliit.example.com`. Configure off-server Postgres backups separately.

## Health check

The application has a health check endpoint that can be used to check if the application is running and if the database is accessible.

- `GET /health/readiness` or `GET /health` - Check if the API is ready to serve requests, including database connectivity.
- `GET /health/liveness` - Check if the API process is running, but not necessarily ready to serve requests.

## Opt-in features

### Expense documents

Spliit offers users to upload images (to an AWS S3 bucket) and attach them to expenses. To enable this feature:

- Create and configure an S3-compatible bucket where images will be stored.
- Update your environments variables with appropriate values:

```.env
PUBLIC_ENABLE_EXPENSE_DOCUMENTS=true
S3_UPLOAD_KEY=AAAAAAAAAAAAAAAAAAAA
S3_UPLOAD_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
S3_UPLOAD_BUCKET=name-of-s3-bucket
S3_UPLOAD_REGION=us-east-1
```

You can also use other S3 providers by providing a custom endpoint:

```.env
S3_UPLOAD_ENDPOINT=http://localhost:9000
```

### Create expense from receipt

You can offer users to create expense by uploading a receipt. This feature relies on [OpenAI GPT-4 with Vision](https://platform.openai.com/docs/guides/vision) and a public S3 storage endpoint.

To enable the feature:

- You must enable expense documents feature as well (see section above). That might change in the future, but for now we need to store images to make receipt scanning work.
- Subscribe to OpenAI API and get access to GPT 4 with Vision (you might need to buy credits in advance).
- Update your environment variables with appropriate values:

```.env
PUBLIC_ENABLE_RECEIPT_EXTRACT=true
OPENAI_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Deduce category from title

You can offer users to automatically deduce the expense category from the title. Since this feature relies on a OpenAI subscription, follow the signup instructions above and configure the following environment variables:

```.env
PUBLIC_ENABLE_CATEGORY_EXTRACT=true
OPENAI_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

## License

MIT, see [LICENSE](./LICENSE).
