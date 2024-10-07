import React from "react";
import { ethers } from "ethers";
import TokenArtifact from "../contracts/Token.json";
import contractAddress from "../contracts/contract-address.json";
import { NoWalletDetected } from "./NoWalletDetected";
import { ConnectWallet } from "./ConnectWallet";
import { Loading } from "./Loading";
import { Transfer } from "./Transfer";
import { TransactionErrorMessage } from "./TransactionErrorMessage";
import { WaitingForTransactionMessage } from "./WaitingForTransactionMessage";
import { NoTokensMessage } from "./NoTokensMessage";

const HARDHAT_NETWORK_ID = "31337";
const ERROR_CODE_TX_REJECTED_BY_USER = 4001;

export class Dapp extends React.Component {
  constructor(props) {
    super(props);

    this.initialState = {
      tokenData: undefined,
      selectedAddress: undefined,
      balance: undefined,
      txBeingSent: undefined,
      transactionError: undefined,
      networkError: undefined,
      totalSupply: undefined,
    };

    this.state = this.initialState;
  }

  // Stops polling and other operations on unmount
  componentWillUnmount() {
    this._stopPollingData();
  }

  render() {
    // If MetaMask or other wallet is not detected
    if (window.ethereum === undefined) {
      return <NoWalletDetected />;
    }

    // If wallet is not connected
    if (!this.state.selectedAddress) {
      return (
        <ConnectWallet
          connectWallet={() => this._connectWallet()}
          networkError={this.state.networkError}
          dismiss={() => this._dismissNetworkError()}
        />
      );
    }

    // If token data, balance, or total supply is not available
    if (!this.state.tokenData || !this.state.balance || !this.state.totalSupply) {
      return <Loading />;
    }

    return (
      <div className="container p-4">
        <div className="row">
          <div className="col-12">
            <h1>
              {this.state.tokenData.name} ({this.state.tokenData.symbol})
            </h1>
            <p>
              Welcome <b>{this.state.selectedAddress}</b>, you have{" "}
              <b>{this.state.balance.toString()} {this.state.tokenData.symbol}</b>.
            </p>
            <h3>
              Total Supply: {ethers.utils.formatUnits(this.state.totalSupply, 18)} {this.state.tokenData.symbol}
            </h3>
          </div>
        </div>

        <hr />

        <div className="row">
          <div className="col-12">
            {this.state.txBeingSent && (
              <WaitingForTransactionMessage txHash={this.state.txBeingSent} />
            )}
            {this.state.transactionError && (
              <TransactionErrorMessage
                message={this._getRpcErrorMessage(this.state.transactionError)}
                dismiss={() => this._dismissTransactionError()}
              />
            )}
          </div>
        </div>

        <div className="row">
          <div className="col-12">
            {this.state.balance.eq(0) && (
              <NoTokensMessage selectedAddress={this.state.selectedAddress} />
            )}
            {this.state.balance.gt(0) && (
              <Transfer
                transferTokens={(to, amount) => this._transferTokens(to, amount)}
                tokenSymbol={this.state.tokenData.symbol}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connect wallet and handle network check
  async _connectWallet() {
    try {
      const [selectedAddress] = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      // Check if connected to the correct network
      this._checkNetwork();

      // Initialize wallet and contract data
      this._initialize(selectedAddress);

      // Handle account change
      window.ethereum.on("accountsChanged", ([newAddress]) => {
        this._stopPollingData();
        if (newAddress === undefined) {
          this._resetState();
        } else {
          this._initialize(newAddress);
        }
      });

    } catch (error) {
      console.error("Error connecting wallet:", error);
    }
  }

  // Initialize contract and data
  _initialize(userAddress) {
    this.setState({ selectedAddress: userAddress });
    this._initializeEthers();
    this._getTokenData();
    this._startPollingData();
  }

  // Initialize ethers.js and connect to the contract
  async _initializeEthers() {
    this._provider = new ethers.providers.Web3Provider(window.ethereum);
    this._token = new ethers.Contract(
      contractAddress.Token,
      TokenArtifact.abi,
      this._provider.getSigner(0)
    );
  }

  // Poll data like balance and total supply periodically
  _startPollingData() {
    this._pollDataInterval = setInterval(() => {
      this._updateBalance();
      this._updateTotalSupply();
    }, 1000);

    this._updateBalance();
    this._updateTotalSupply();
  }

  // Stop polling data
  _stopPollingData() {
    clearInterval(this._pollDataInterval);
    this._pollDataInterval = undefined;
  }

  // Get token name, symbol, and total supply
  async _getTokenData() {
    const name = await this._token.name();
    const symbol = await this._token.symbol();
    const totalSupply = await this._token.totalSupply();

    this.setState({ tokenData: { name, symbol }, totalSupply });
  }

  // Update user's balance
  async _updateBalance() {
    const balance = await this._token.balanceOf(this.state.selectedAddress);
    this.setState({ balance });
  }

  // Update total supply
  async _updateTotalSupply() {
    const totalSupply = await this._token.totalSupply();
    this.setState({ totalSupply });
  }

  // Transfer tokens
  async _transferTokens(to, amount) {
    try {
      this._dismissTransactionError();

      const tx = await this._token.transfer(to, amount);
      this.setState({ txBeingSent: tx.hash });

      const receipt = await tx.wait();
      if (receipt.status === 0) {
        throw new Error("Transaction failed");
      }

      // Update balance and total supply after transfer
      await this._updateBalance();
      await this._updateTotalSupply();
    } catch (error) {
      if (error.code === ERROR_CODE_TX_REJECTED_BY_USER) {
        return;
      }
      console.error(error);
      this.setState({ transactionError: error });
    } finally {
      this.setState({ txBeingSent: undefined });
    }
  }

  // Dismiss transaction error
  _dismissTransactionError() {
    this.setState({ transactionError: undefined });
  }

  // Dismiss network error
  _dismissNetworkError() {
    this.setState({ networkError: undefined });
  }

  // Handle RPC error messages
  _getRpcErrorMessage(error) {
    return error.data ? error.data.message : error.message;
  }

  // Reset state to initial values
  _resetState() {
    this.setState(this.initialState);
  }

  // Switch to the correct network
  async _switchChain() {
    const chainIdHex = `0x${HARDHAT_NETWORK_ID.toString(16)}`;
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    this._initialize(this.state.selectedAddress);
  }

  // Check if the user is connected to the correct network
  _checkNetwork() {
    if (window.ethereum.networkVersion !== HARDHAT_NETWORK_ID) {
      this._switchChain();
    }
  }
}
