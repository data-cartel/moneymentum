# Infrastructure

Terraform + NixOS on DigitalOcean. State is encrypted at rest
(`terraform.tfstate.age`, `terraform.tfvars.age`).

## Commands

```bash
nix run .#tfPlan          # Preview changes
nix run .#tfApply         # Apply the plan
nix run .#tfImport        # Import existing resource into state
nix run .#bootstrap       # Install NixOS on a fresh droplet (nixos-anywhere)
nix run .#remote          # SSH into the droplet
nix run .#tfEditVars      # Edit encrypted tfvars
nix run .#tfCreateVars    # Create tfvars from example
nix run .#tfInit          # Initialize terraform
```

## SSH access

Set `ssh_key_names` in encrypted Terraform vars to every DigitalOcean SSH key
that should be embedded into freshly created droplets. Keep the GitHub Actions
key and operator keys in the list before reprovisioning.

## Destroying resources

There is no `terraform destroy` command. All destruction goes through the same
plan/apply cycle as creation:

- **Reprovision** (temporary): Comment out the resource in `main.tf`, plan,
  apply, uncomment, plan, apply, bootstrap.
- **Permanent removal**: Delete the resource from `main.tf`, plan, apply.

This forces you to review exactly what will be destroyed before it happens and
prevents accidentally nuking persistent resources like volumes.

## Reprovisioning the droplet

1. Comment out the droplet and any resources that reference it (volume
   attachment, IP assignment) in `main.tf`. Comment out corresponding outputs in
   `outputs.tf`.
2. `nix run .#tfPlan` -- verify only the intended resources are being destroyed.
   Volume and reserved IP must survive.
3. `nix run .#tfApply`
4. Uncomment everything.
5. `nix run .#tfPlan` -- verify the droplet, attachment, and IP assignment are
   being recreated.
6. `nix run .#tfApply`
7. `nix run .#bootstrap` -- installs NixOS, waits for reboot, updates the host
   key in `keys.nix`, and rekeys all secrets.
8. Commit the updated `keys.nix` and rekeyed secrets.
