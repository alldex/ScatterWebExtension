import Plugin from '../Plugin';
import * as PluginTypes from '../PluginTypes';
import {Blockchains} from '../../models/Blockchains';
import Network from '../../models/Network';
import Account from '../../models/Account';
import AlertMsg from '../../models/alerts/AlertMsg';
import * as Actions from '../../store/constants';
import ObjectHelpers from '../../util/ObjectHelpers';
import {GXClient} from 'gxclient';
import {PrivateKey, Signature} from 'gxbjs';
import Error from "../../models/errors/Error";

let networkGetter = new WeakMap();
let messageSender = new WeakMap();
let throwIfNoIdentity = new WeakMap();

const proxy = (dummy, handler) => new Proxy(dummy, handler);

export default class GXC extends Plugin {

    constructor() {
        super(Blockchains.GXC, PluginTypes.BLOCKCHAIN_SUPPORT);
    }

    accountFormatter(account) {
        return `${account.name}@${account.authority}`;
    }

    returnableAccount(account) {
        return {name: account.name, authority: account.authority};
    }

    async getEndorsedNetwork() {
        return new Promise((resolve, reject) => {
            resolve(new Network(
                'GXChain Mainnet', 'https',
                'node11.gxb.io',
                443,
                Blockchains.GXC,
                '4f7d07969c446f8342033acb3ab2ae5044cbe0fde93db02de75bd17fa8fd84b8'
            ));
        });
    }

    async isEndorsedNetwork(network) {
        const endorsedNetwork = await this.getEndorsedNetwork();
        return network.hostport() === endorsedNetwork.hostport();
    }

    accountsAreImported() {
        return true;
    }

    importAccount(keypair, network, context, accountSelected) {
        const getAccountsFromPublicKey = (publicKey, network) => {
            return new Promise((resolve, reject) => {
                let client = new GXClient("", "", `wss://${network.hostport()}`);
                client.getAccountByPublicKey(publicKey).then(account_ids => {
                    client._query("get_objects", [account_ids]).then(accounts => {
                        let results = [];
                        accounts.forEach(acc => {
                            if (acc.owner.key_auths.find(k => k[0] === publicKey)) {
                                results.push({name: acc.name, authority: 'owner'});
                            }
                            if (acc.active.key_auths.find(k => k[0] === publicKey)) {
                                results.push({name: acc.name, authority: 'active'});
                            }
                        });
                        resolve(results);
                    });
                }).catch(e => resolve([]));
            });
        };

        getAccountsFromPublicKey(keypair.publicKey, network).then(accounts => {
            switch (accounts.length) {
                case 0:
                    context[Actions.PUSH_ALERT](AlertMsg.NoAccountsFound());
                    reject();
                    return false;
                // Only one account, so returning it
                case 1:
                    accountSelected(Account.fromJson({
                        name: accounts[0].name,
                        authority: accounts[0].authority,
                        publicKey: keypair.publicKey,
                        keypairUnique: keypair.unique()
                    }));
                    break;
                // More than one account, prompting account selection
                default:
                    context[Actions.PUSH_ALERT](AlertMsg.SelectAccount(accounts)).then(res => {
                        if (!res || !res.hasOwnProperty('selected')) {
                            reject();
                            return false;
                        }
                        accountSelected(Account.fromJson(Object.assign(res.selected, {
                            publicKey: keypair.publicKey,
                            keypairUnique: keypair.unique()
                        })));
                    });
            }
        }).catch(e => {
            console.log('error', e);
            accountSelected(null);
        });
    }

    privateToPublic(privateKey) {
        let client = new GXClient();
        return client.privateToPublic(privateKey);
    }

    validPrivateKey(privateKey) {
        let client = new GXClient();
        return client.isValidPrivate(privateKey);
    }

    validPublicKey(publicKey) {
        let client = new GXClient();
        return client.isValidPublic(publicKey);
    }

    randomPrivateKey() {
        let client = new GXClient();
        return new Promise((resolve) => {
            resolve(client.generateKey().privateKey);
        });
    }

    convertsTo() {
        return [];
    }

    from_eth(privateKey) {
        return PrivateKey.fromHex(Buffer.from(privateKey, 'hex')).toWif();
    }

    async getBalances(account, network) {
        let client = new GXClient("", "", `wss://${network.hostport()}`);
        return client.getAccountBalances(account.name).then(balances => {
            return client._query("get_objects", [balances.map(b => b.asset_id)]).then(assets => {
                let result = balances.map(b => {
                    let asset = assets.find(a => a.id === b.asset_id);
                    return [asset.symbol, b.amount / Math.pow(10, asset.precision)];
                });
                console.log(result);
                return result;
            });
        });
    }

    actionParticipants(payload) {
        return ObjectHelpers.flatten(
            payload.messages
                .map(message => message.authorization
                    .map(auth => `${auth.actor}@${auth.permission}`))
        );
    }

    signer(bgContext, payload, publicKey, callback) {
        bgContext.publicToPrivate(privateKey => {
            if (!privateKey) {
                callback(null);
                return false;
            }
            let sig = Signature.sign(payload.data, PrivateKey.fromWif(privateKey)).toString('hex');
            callback(sig);
        }, publicKey);
    }

    signatureProvider(...args) {

        messageSender = args[0];
        throwIfNoIdentity = args[1];

        return (network) => {

            network = Network.fromJson(network);
            if (!network.isValid()) throw Error.noNetwork();

            return {
                vote: function (account_ids, options) {
                    console.log('vote', arguments);
                },
                transfer: function (from, to, amount, options) {
                    console.log('transfer', arguments);
                },
                contract: function (contract_name, method, params, options) {
                    console.log('contract', arguments);
                }
            };
        };
    }


}
