use std::sync::Arc;

use tokio::sync::Mutex;

use crate::rpc::RpcClient;

#[derive(Default)]
pub struct AppState {
	pub client: Arc<Mutex<Option<RpcClient>>>,
}
