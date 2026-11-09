import { test } from 'node:test';
import assert from 'node:assert/strict';
import './env.js';
import { CC_COLOR, CC_SUCCESS_COLOR, ccEmbed } from '../src/config/cc.js';
import { bourseAssets } from '../src/config/store/bourse.js';
import {
    confirmInvestPayload, confirmSellAllPayload, confirmSellPayload, investReceiptEmbed, sellAllReceiptEmbed, sellReceiptEmbed,
} from '../src/services/cc/bourseUi.js';

// A trade's confirmation message is replaced by its receipt with `interaction.editReply`; Discord rejects the edit
// (and the bot swallows the error, leaving the old buttons on screen so the trade can be repeated) when an embed
// colour is not a whole number. These tests keep every bourse embed colour valid.
const validColor = (color) => Number.isInteger(color) && color >= 0 && color <= 0xffffff;
const asset = bourseAssets[0];
const user = { toString: () => '<@1>', displayName: 'A', displayAvatarURL: () => null };

test('every bourse confirmation and receipt embed has a valid colour', () => {
    const embeds = [
        investReceiptEmbed(user, { asset, quantity: 2, price: 100, cost: 200, owned: 3, before: 1000, balance: 800 }),
        sellReceiptEmbed(user, { asset, quantity: 1, price: 100, fee: 2, received: 98, profit: 10, owned: 2, before: 800, balance: 898 }),
        sellAllReceiptEmbed(user, [{ asset, quantity: 1, received: 98, paid: 88 }], { before: 800, balance: 898 }),
        ...confirmInvestPayload(asset, 1, 100, '1', 1000).embeds,
        ...confirmSellPayload(asset, 1, 100, '1', { owned: 2, paid: 180 }).embeds,
        ...confirmSellAllPayload([{ asset, qty: 1, value: 100, ifSold: 98, paid: 90, price: 100 }], '1', 5).embeds,
    ];
    for (const embed of embeds) assert.ok(validColor(embed.color), `${embed.title}: ${embed.color}`);
    // The receipts are green, the confirmations gold.
    assert.equal(embeds[0].color, CC_SUCCESS_COLOR);
    assert.equal(embeds[3].color, CC_COLOR);
});

test('ccEmbed ignores a colour that is not a whole number between 0 and 0xffffff', () => {
    for (const bad of ['success', '#2ecc71', -1, 0x1000000, 1.5, NaN, null, {}]) assert.equal(ccEmbed('x', '', { color: bad }).color, CC_COLOR, String(bad));
    assert.equal(ccEmbed('x', '', { color: 0x123456 }).color, 0x123456);
    assert.equal(ccEmbed('x').color, CC_COLOR);
});
