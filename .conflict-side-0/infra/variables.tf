variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "ssh_key_names" {
  description = "Names of the SSH keys in DigitalOcean to add to the droplet"
  type        = list(string)
  default     = ["moneymentum"]
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
  default     = "nyc3"
}

variable "droplet_size" {
  description = "Droplet size slug"
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "volume_size_gb" {
  description = "Block storage volume size in GB"
  type        = number
  default     = 5
}
