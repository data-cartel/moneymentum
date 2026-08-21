use clap::Parser;
use moneymentum::{Config, run_local_ingest};

#[derive(Parser)]
struct Env {
    #[arg(long = "config", env)]
    config_path: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let env = Env::parse();
    let config = Config::load(&env.config_path)?;
    run_local_ingest(config).await?;
    Ok(())
}
