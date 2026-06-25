<img alt="Spliit" height="60" src="https://github.com/antonio-ivanovski/spliit-cloud/blob/main/apps/web/public/logo-with-text.svg?raw=true" />

Spliit is a free and open source alternative to Splitwise.

Spliit Cloud is deployed at [spliit.cloud](https://spliit.cloud).

Spliit Cloud is a community fork of Spliit, originally created by [Sebastien Castiel](https://github.com/scastiel). The original `spliit-app/spliit` project appears inactive, with issues and pull requests not receiving maintainer responses. This fork exists to keep the project moving in a more focused direction.

The initial goals are:

- make the tech stack lighter and easier to operate
- build out complete test coverage
- make authenticated cloud accounts the source of truth
- move group and direct expense accounting onto a shared ledger model
- provide an extensible import path for existing expense data, starting with Spliit groups

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fantonio-ivanovski%2Fspliit-cloud&project-name=my-spliit-cloud-instance&repository-name=my-spliit-cloud-instance&stores=%5B%7B%22type%22%3A%22postgres%22%7D%5D&)

## Features

- [x] Create a group and share it with friends
- [x] Create expenses with description
- [x] Display group balances
- [x] Create reimbursement expenses
- [x] Progressive Web App
- [x] Select all/no participant for expenses
- [x] Split expenses unevenly
- [x] Mark a group as favorite
- [x] Tell the application who you are when opening a group
- [x] Assign a category to expenses
- [x] Search for expenses in a group
- [x] Upload and attach images to expenses
- [x] Create expense by scanning a receipt
- [x] [Cloud accounts and group synchronization](./openspec/changes/add-accounts-cloud-group-sync)

### Possible incoming features

- [ ] Ability to create recurring expenses
- [ ] MCP and simplified API surface for AI agent based usage
- [ ] Publish API OpenAPI spec
- [ ] Continue bundle-size reduction work. TanStack lazy routes and react-i18next lazy locale loading are already in place; current low-hanging fruit work resulted in the main chunk from roughly 1500 kB to 750 kB.
- [ ] Complete offline usage and sync when online
- [ ] Admin and self member management
- [ ] Update the rest of the tech stack, including TypeScript
- [ ] Self account settings, including synced theme preferences and display name
- [ ] [Direct account-to-account expenses](./openspec/changes/add-direct-account-expenses)
- [ ] [Account overview homepage](./openspec/changes/add-overview-homepage)
- [ ] [Extensible expense import, starting with Spliit groups](./openspec/changes/import-spliit-groups)
- [ ] End-to-end encrypted groups and expenses

## Stack

- [Vite](https://vite.dev/) + [React](https://react.dev/) for the web SPA, replacing Next.js in favor of simplicity, efficiency, and room for future expansion
- [Hono](https://hono.dev/) + [tRPC](https://trpc.io/) for the API, also chosen over Next.js API routes for a smaller and more explicit runtime
- [Bun](https://bun.sh/) for package management and the API runtime
- [TailwindCSS](https://tailwindcss.com/) for the styling
- [shadcn/UI](https://ui.shadcn.com/) for the UI components
- [Prisma](https://prisma.io) to access the database

## Contribute

The project is open to contributions. Feel free to open an issue or even a pull-request!

Financial support links are TBD.

### Translation

Weblate is not set up for this fork yet. Until then, translation contributions
are still welcome as direct JSON changes in the locale files.

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

Spliit Cloud offers users to upload images (to an AWS S3 bucket) and attach them to expenses. To enable this feature:

- Create and configure an S3-compatible bucket where images will be stored.
- Update your environments variables with appropriate values:

```.env
PUBLIC_ENABLE_EXPENSE_DOCUMENTS=true
S3_UPLOAD_KEY=AAAAAAAAAAAAAAAAAAAA
S3_UPLOAD_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
S3_UPLOAD_BUCKET=name-of-s3-bucket
S3_UPLOAD_REGION=us-east-1
S3_UPLOAD_PUBLIC_URL=https://uploads.example.com
```

You can also use other S3 providers by providing a custom endpoint:

```.env
S3_UPLOAD_ENDPOINT=http://localhost:9000
```

`S3_UPLOAD_ENDPOINT` is used for signing uploads. `S3_UPLOAD_PUBLIC_URL` is an
optional browser-readable base URL stored on expense documents and must serve
objects by key, for example `https://uploads.example.com/document-...jpg`. If it
is not configured, documents use the default AWS S3 public URL format.

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
