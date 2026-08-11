data "digitalocean_ssh_key" "deploy" {
  for_each = toset(var.ssh_key_names)
  name     = each.value
}

resource "digitalocean_volume" "data" {
  region                  = var.region
  name                    = "moneymentum-data"
  size                    = var.volume_size_gb
  initial_filesystem_type = "ext4"
  description             = "Persistent storage for SQLite databases and logs"
}

resource "digitalocean_droplet" "nixos" {
  # Keep digitalocean_droplet.nixos on Ubuntu; nixos-anywhere replaces it with NixOS.
  image    = "ubuntu-24-04-x64"
  name     = "moneymentum-nixos"
  region   = var.region
  size     = var.droplet_size
  ssh_keys = [for deploy_key in data.digitalocean_ssh_key.deploy : deploy_key.id]
}

resource "digitalocean_volume_attachment" "data" {
  droplet_id = digitalocean_droplet.nixos.id
  volume_id  = digitalocean_volume.data.id
}

resource "digitalocean_reserved_ip" "nixos" {
  region = var.region
}

resource "digitalocean_reserved_ip_assignment" "nixos" {
  ip_address = digitalocean_reserved_ip.nixos.ip_address
  droplet_id = digitalocean_droplet.nixos.id
}
