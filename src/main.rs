use std::net::{Ipv4Addr, SocketAddr};

use clap::Parser;
use moneymentum::{Config, app};
use tracing::info;

#[derive(Parser)]
struct Env {
    #[arg(long = "config", env)]
    config_path: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let env = Env::parse();
    let config = Config::load(&env.config_path)?;
    let port = config.port();
    let router = app(config).await?;
    let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(port = listener.local_addr()?.port(), "moneymentum ready");
    axum::serve(listener, router).await?;
    Ok(())
}
