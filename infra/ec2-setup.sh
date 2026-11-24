#!/usr/bin/env bash
# Run ON the EC2 instance (Amazon Linux 2023) after copying the project to /opt/pulsecity and creating backend/.env
set -euo pipefail
sudo dnf install -y nodejs20 amazon-cloudwatch-agent
sudo useradd --system --home /opt/pulsecity pulsecity 2>/dev/null || true
sudo mkdir -p /var/log/pulsecity && sudo chown pulsecity /var/log/pulsecity
cd /opt/pulsecity/frontend && npm install && npm run build
cd /opt/pulsecity/backend && npm install --omit=dev
sudo chown -R pulsecity /opt/pulsecity && sudo chmod 600 /opt/pulsecity/backend/.env
sudo cp /opt/pulsecity/infra/pulsecity.service /etc/systemd/system/
sudo cp /opt/pulsecity/infra/cw-agent.json /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
sudo systemctl daemon-reload && sudo systemctl enable --now pulsecity
sleep 2 && curl -fs localhost/api/health && echo " <- PulseCity is live"
