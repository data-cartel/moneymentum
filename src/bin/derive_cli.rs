use std::net::{Ipv4Addr, SocketAddr};

use clap::Parser;
use derive::derive_app;
use moneymentum::Config;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
struct Env {
    #[arg(long = "config", env)]
    config_path: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let env = Env::parse();
    let config = Config::load(&env.config_path)?;
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("derive=info,moneymentum=info,tower_http=info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    let derive_config = config
        .derive
        .ok_or(moneymentum::ConfigError::MissingDeriveConfig)?;
    let port = derive_config.port;
    let router = derive_app(derive_config).await?;
    let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(
        port = listener.local_addr()?.port(),
        "derive options server ready"
    );
    axum::serve(listener, router).await?;
    Ok(())
}
