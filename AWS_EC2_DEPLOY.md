# LinkOps Backend on AWS EC2

This is the fastest deployment path for the hackathon: one EC2 instance runs the API, worker, and Redis using Docker Compose. MongoDB stays on MongoDB Atlas and the frontend stays on Vercel.

## 1. Create EC2

- AMI: Ubuntu Server 22.04 or 24.04 LTS
- Instance type: `t3.small` recommended for Puppeteer, `t2.micro` may be tight
- Storage: 20 GB
- Security group inbound rules:
  - SSH `22` from your IP
  - HTTP/API `8000` from anywhere for quick demo
  - Optional HTTP `80` and HTTPS `443` if you later add Nginx

## 2. SSH Into EC2

```bash
ssh -i /path/to/key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

## 3. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
newgrp docker
```

## 4. Clone Backend

```bash
git clone https://github.com/ShivamKmishra09/linkops-backend.git
cd linkops-backend
```

## 5. Add Production Env

```bash
cp .env.production.example .env.production
nano .env.production
```

Fill at least:

```env
DB_URL=
JWT_KEY=
SESSION_SECRET=
BIFROST_API_KEY=
AUTH_PROFILE_ENCRYPTION_KEY=
CONNECTOR_ENCRYPTION_KEY=
REACT_APP_FRONTEND_URL=https://linkops-frontend.vercel.app
```

For local Redis inside Compose, do not set `REDIS_URL` in `.env.production`; the compose file sets it to `redis://redis:6379`.

## 6. Start Services

```bash
docker compose -f docker-compose.aws.yml up -d --build
```

Check logs:

```bash
docker compose -f docker-compose.aws.yml logs -f api
docker compose -f docker-compose.aws.yml logs -f worker
```

Health check:

```bash
curl http://YOUR_EC2_PUBLIC_IP:8000/
```

Expected:

```text
Hello
```

## 7. Update Vercel Frontend

Set frontend env vars in Vercel:

```env
REACT_APP_BACKEND_URL=http://YOUR_EC2_PUBLIC_IP:8000
REACT_APP_FRONTEND_URL=https://linkops-frontend.vercel.app
```

Redeploy the frontend.

## Useful Commands

```bash
docker compose -f docker-compose.aws.yml ps
docker compose -f docker-compose.aws.yml restart api
docker compose -f docker-compose.aws.yml restart worker
docker compose -f docker-compose.aws.yml down
docker compose -f docker-compose.aws.yml up -d --build
```
