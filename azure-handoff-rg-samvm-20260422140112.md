# Azure Deployment Handoff

## Overview

- Subscription: `Azure subscription 1`
- Subscription ID: `ab220dad-96bc-4d76-ae6c-83975c574885`
- Tenant: `Ward Electric Company`
- Tenant ID: `6b6dd46a-3c38-4291-8301-a5963772a123`
- Region: `eastus`
- Resource Group: `rg-samvm-20260422140112`

## Access

- SSH public endpoint: `13.90.26.21`
- SSH command: `ssh ubuntu@13.90.26.21`
- SSH allowed source range: `38.158.148.0/24`
- VM admin user: `ubuntu`
- VM public IP: none
- VM private IP: `10.10.2.4`

## Web Entry

- Application Gateway public IP: `52.186.143.13`
- Application Gateway FQDN: `samvm-20260422140112.eastus.cloudapp.azure.com`
- HTTP: `http://samvm-20260422140112.eastus.cloudapp.azure.com`
- HTTPS: `https://samvm-20260422140112.eastus.cloudapp.azure.com`
- HTTPS certificate: self-signed

## Compute

- VM name: `vm-samvm-20260422140112`
- VM size: `Standard_D4ds_v6`
- OS image target: Ubuntu 24.04 LTS
- NIC: `nic-samvm-20260422140112`
- VNet: `vnet-samvm-20260422140112`
- VM subnet: `vm-subnet` (`10.10.2.0/24`)
- Application Gateway subnet: `appgw-subnet` (`10.10.1.0/24`)
- NSG: `nsg-samvm-20260422140112`

## Storage

- Data disk name: `disk-samvm-20260422140112`
- Data disk size: `1024 GiB`
- Data disk mount: `/mnt/data`
- Data disk device path in guest: `/dev/nvme0n2p1`
- Disk state verified: attached, formatted `ext4`, mounted, persisted in `/etc/fstab`

## Network Components

- Application Gateway: `agw-samvm-20260422140112`
- Application Gateway listeners: `80`, `443`
- Application Gateway routing rules:
  - `rule1` priority `100`
  - `rule-https` priority `110`
- SSH Load Balancer: `lb-samvm-20260422140112`
- SSH Load Balancer public IP resource: `pip-lb-samvm-20260422140112`
- Application Gateway public IP resource: `pip-agw-samvm-20260422140112`
- Load balancer inbound NAT rule: `ssh-22` maps frontend `22` to backend `22`

## Current State

- VM has no public IP.
- Application Gateway is the web ingress for ports `80/443`.
- Load Balancer is the SSH ingress for port `22`.
- Nginx was installed during provisioning to provide a backend HTTP service.

## Operational Notes

- Browsers will show an HTTPS warning until the self-signed cert is replaced with a trusted cert for your real domain.
- When the domain is ready, replace the Application Gateway certificate with a proper certificate, preferably sourced from Key Vault.
- SSH access is intentionally blocked from any source outside `38.158.148.0/24`.
- I verified Azure resource configuration and guest disk state. I did not verify a live SSH login from an allowed source IP from this environment.

## Useful Commands

```bash
az group show -n rg-samvm-20260422140112 -o json
az resource list -g rg-samvm-20260422140112 -o table
az vm show -g rg-samvm-20260422140112 -n vm-samvm-20260422140112 --show-details -o json
az network application-gateway show -g rg-samvm-20260422140112 -n agw-samvm-20260422140112 -o json
az network lb show -g rg-samvm-20260422140112 -n lb-samvm-20260422140112 -o json
```

## Local Deployment Artifacts

- Script: [azure_deploy_vm.sh](/home/samuel/azure_deploy_vm.sh)
- Resume script: [azure_resume_appgw_lb.sh](/home/samuel/azure_resume_appgw_lb.sh)
