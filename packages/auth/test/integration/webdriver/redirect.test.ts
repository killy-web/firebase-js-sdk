/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// eslint-disable-next-line import/no-extraneous-dependencies
import {
  OperationType,
  UserCredential,
  User,
  OAuthCredential
} from '@firebase/auth';
import { expect, use } from 'chai';
import { IdPPage } from './util/idp_page';
import chaiAsPromised from 'chai-as-promised';
import { browserDescribe } from './util/test_runner';
import {
  AnonFunction,
  CoreFunction,
  EmailFunction,
  MiddlewareFunction,
  RedirectFunction
} from './util/functions';
import { JsLoadCondition } from './util/js_load_condition';
import { START_FUNCTION } from './util/auth_driver';

use(chaiAsPromised);

browserDescribe('WebDriver redirect IdP test', driver => {
  beforeEach(async () => {
    await driver.pause(200); // Race condition on auth init
  });

  it('1 - allows users to sign in', async () => {
    await driver.callNoWait(RedirectFunction.IDP_REDIRECT);
    const widget = new IdPPage(driver.webDriver);

    // We're now on the widget page; wait for load
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('bob@bob.test1');
    await widget.fillDisplayName('Bob Test1');
    await widget.fillScreenName('bob.test1');
    await widget.fillProfilePhoto('http://bob.test/bob.png');
    await widget.clickSignIn();

    await driver.reinitOnRedirect();
    const currentUser = await driver.getUserSnapshot();
    console.log('1 - currentUser.email: ', currentUser.email);
    expect(currentUser.email).to.eq('bob@bob.test1');
    expect(currentUser.displayName).to.eq('Bob Test1');
    expect(currentUser.photoURL).to.eq('http://bob.test/bob.png');

    const redirectResult: UserCredential = await driver.call(
      RedirectFunction.REDIRECT_RESULT
    );
    expect(redirectResult.operationType).to.eq(OperationType.SIGN_IN);
    expect(redirectResult.user).to.eql(currentUser);

    // After the first call to redirect result, redirect result should be
    // null
    expect(await driver.call(RedirectFunction.REDIRECT_RESULT)).to.be.null;
  });

  // Redirect works with middleware for now
  it('2 - is blocked by middleware', async function () {
    if (driver.isCompatLayer()) {
      console.warn('Skipping middleware tests in compat');
      this.skip();
    }

    await driver.callNoWait(RedirectFunction.IDP_REDIRECT);
    const widget = new IdPPage(driver.webDriver);

    // We're now on the widget page; wait for load
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('bob@bob.test2');
    await widget.fillDisplayName('Bob Test2');
    await widget.fillScreenName('bob.test2');
    await widget.fillProfilePhoto('http://bob.test/bob.png');
    await widget.clickSignIn();
    await driver.webDriver.wait(new JsLoadCondition(START_FUNCTION));
    await driver.call(MiddlewareFunction.ATTACH_BLOCKING_MIDDLEWARE_ON_START);

    await driver.reinitOnRedirect();
    await expect(
      driver.call(RedirectFunction.REDIRECT_RESULT)
    ).to.be.rejectedWith('auth/login-blocked');
    expect(await driver.getUserSnapshot()).to.be.null;
  });

  it('3 - can link with another account account', async () => {
    // First, sign in anonymously
    const { user: anonUser }: UserCredential = await driver.call(
      AnonFunction.SIGN_IN_ANONYMOUSLY
    );

    // Then, link with redirect
    await driver.callNoWait(RedirectFunction.IDP_LINK_REDIRECT);
    const widget = new IdPPage(driver.webDriver);
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('bob@bob.test3');
    await widget.clickSignIn();

    await driver.reinitOnRedirect();
    // Back on page; check for the current user matching the anonymous account
    // as well as the new IdP account
    const user3: User = await driver.getUserSnapshot();
    console.log('3 - currentUser.email: ', user3.email);
    expect(user3.uid).to.eq(anonUser.uid);
    expect(user3.email).to.eq('bob@bob.test3');
  });

  it('4 - can be converted to a credential', async () => {
    // Start with redirect
    await driver.callNoWait(RedirectFunction.IDP_REDIRECT);
    const widget = new IdPPage(driver.webDriver);
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('bob@bob.test4');
    await widget.clickSignIn();

    // Generate a credential, then store it on the window before logging out
    await driver.reinitOnRedirect();
    const first = await driver.getUserSnapshot();
    console.log('4 - currentUser.email: ', first.email);
    const cred: OAuthCredential = await driver.call(
      RedirectFunction.GENERATE_CREDENTIAL_FROM_RESULT
    );
    expect(cred.accessToken).to.be.a('string');
    expect(cred.idToken).to.be.a('string');
    expect(cred.signInMethod).to.eq('google.com');

    // We've now generated that credential. Sign out and sign back in using it
    await driver.call(CoreFunction.SIGN_OUT);
    const { user: second }: UserCredential = await driver.call(
      RedirectFunction.SIGN_IN_WITH_REDIRECT_CREDENTIAL
    );
    expect(second.uid).to.eq(first.uid);
    expect(second.providerData).to.eql(first.providerData);
  });

  it('5 - handles account exists different credential errors', async () => {
    // Start with redirect and a verified account
    await driver.callNoWait(RedirectFunction.IDP_REDIRECT);
    const widget = new IdPPage(driver.webDriver);
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('bob@bob.test5');
    await widget.clickSignIn();
    await driver.reinitOnRedirect();

    const original = await driver.getUserSnapshot();
    console.log('5a - currentUser.email: ', original.email);
    expect(original.emailVerified).to.be.true;

    // Try to sign in with an unverified Facebook account
    // TODO: Convert this to the widget once unverified accounts work
    // Come back and verify error / prepare for link
    await expect(
      driver.call(RedirectFunction.TRY_TO_SIGN_IN_UNVERIFIED, 'bob@bob.test5')
    ).to.be.rejected.and.eventually.have.property(
      'code',
      'auth/account-exists-with-different-credential'
    );

    // Now do the link
    await driver.call(RedirectFunction.LINK_WITH_ERROR_CREDENTIAL);

    // Check the user for both providers
    const user5 = await driver.getUserSnapshot();
    console.log('5b - currentUser.email: ', user5.email);
    expect(user5.uid).to.eq(original.uid);
    expect(user5.providerData.map(d => d.providerId)).to.have.members([
      'google.com',
      'facebook.com'
    ]);
  });

  it('6 - does not auto-upgrade anon accounts', async () => {
    const { user: anonUser }: UserCredential = await driver.call(
      AnonFunction.SIGN_IN_ANONYMOUSLY
    );
    await driver.callNoWait(RedirectFunction.IDP_REDIRECT);
    const widget = new IdPPage(driver.webDriver);
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('bob@bob.test6');
    await widget.clickSignIn();

    // On redirect, check that the signed in user is different
    await driver.reinitOnRedirect();
    const curUser6 = await driver.getUserSnapshot();
    console.log('6 - currentUser.email: ', curUser6.email);
    expect(curUser6.uid).not.to.eq(anonUser.uid);
  });

  it('7 - linking with anonymous user upgrades account', async () => {
    const { user: anonUser }: UserCredential = await driver.call(
      AnonFunction.SIGN_IN_ANONYMOUSLY
    );
    await driver.callNoWait(RedirectFunction.IDP_LINK_REDIRECT);
    const widget = new IdPPage(driver.webDriver);
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('bob@bob.test7');
    await widget.clickSignIn();

    // On redirect, check that the signed in user is upgraded
    await driver.reinitOnRedirect();
    const curUser7 = await driver.getUserSnapshot();
    console.log('7 - currentUser.email: ', curUser7.email);
    expect(curUser7.uid).to.eq(anonUser.uid);
    expect(curUser7.isAnonymous).to.be.false;
  });

  it('8 - is possible to link with different email', async () => {
    const { user: emailUser }: UserCredential = await driver.call(
      EmailFunction.CREATE_USER,
      'user@test.test8'
    );

    // Link using pre-poulated user
    await driver.callNoWait(RedirectFunction.IDP_LINK_REDIRECT);

    const widget = new IdPPage(driver.webDriver);
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('other-user@test.test8');
    await widget.clickSignIn();

    // Check the linked account
    await driver.reinitOnRedirect();
    const curUser8 = await driver.getUserSnapshot();
    console.log('8 - currentUser.email: ', curUser8.email);
    expect(curUser8.uid).to.eq(emailUser.uid);
    expect(curUser8.emailVerified).to.be.false;
    expect(curUser8.providerData.length).to.eq(2);
  });

  it('9 - is possible to link with the same email', async () => {
    const { user: emailUser }: UserCredential = await driver.call(
      EmailFunction.CREATE_USER,
      'same@test.test9'
    );

    // Link using pre-poulated user
    await driver.callNoWait(RedirectFunction.IDP_LINK_REDIRECT);

    const widget = new IdPPage(driver.webDriver);
    await widget.pageLoad();
    await widget.clickAddAccount();
    await widget.fillEmail('same@test.test9');
    await widget.clickSignIn();

    // Check the linked account
    await driver.reinitOnRedirect();
    const curUser9 = await driver.getUserSnapshot();
    console.log('9 - currentUser.email: ', curUser9.email);
    expect(curUser9.uid).to.eq(emailUser.uid);
    expect(curUser9.emailVerified).to.be.true;
    expect(curUser9.providerData.length).to.eq(2);
  });

  context('with existing user', () => {
    let user1: User;
    let user2: User;

    beforeEach(async () => {
      // Create a couple existing users
      let cred: UserCredential = await driver.call(
        RedirectFunction.CREATE_FAKE_GOOGLE_USER,
        'bob@bob.test10x'
      );
      user1 = cred.user;
      cred = await driver.call(
        RedirectFunction.CREATE_FAKE_GOOGLE_USER,
        'sally@sally.test10x'
      );
      user2 = cred.user;
      await driver.call(CoreFunction.SIGN_OUT);
    });

    it('10 - a user can sign in again', async () => {
      // Sign in using pre-poulated user
      await driver.callNoWait(RedirectFunction.IDP_REDIRECT);

      // This time, select an existing account
      const widget = new IdPPage(driver.webDriver);
      await widget.pageLoad();
      await widget.selectExistingAccountByEmail(user1.email!);

      // Double check the new sign in matches the old
      await driver.reinitOnRedirect();
      const user10 = await driver.getUserSnapshot();
      console.log('10 - currentUser.email: ', user10.email);
      expect(user10.uid).to.eq(user1.uid);
      expect(user10.email).to.eq(user1.email);
    });

    it('11 - reauthenticate works for the correct user', async () => {
      // Sign in using pre-poulated user
      await driver.callNoWait(RedirectFunction.IDP_REDIRECT);

      const widget = new IdPPage(driver.webDriver);
      await widget.pageLoad();
      await widget.selectExistingAccountByEmail(user1.email!);

      // Double check the new sign in matches the old
      await driver.reinitOnRedirect();
      let user11 = await driver.getUserSnapshot();
      console.log('11a - currentUser.email: ', user11.email);
      expect(user11.uid).to.eq(user1.uid);
      expect(user11.email).to.eq(user1.email);

      // Reauthenticate specifically
      await driver.callNoWait(RedirectFunction.IDP_REAUTH_REDIRECT);
      await widget.pageLoad();
      await widget.selectExistingAccountByEmail(user1.email!);

      await driver.reinitOnRedirect();
      user11 = await driver.getUserSnapshot();
      console.log('11b - currentUser.email: ', user11.email);
      expect(user11.uid).to.eq(user1.uid);
      expect(user11.email).to.eq(user1.email);
    });

    // it('12 - reauthenticate throws for wrong user', async () => {
    //   // Sign in using pre-poulated user
    //   await driver.callNoWait(RedirectFunction.IDP_REDIRECT);

    //   const widget = new IdPPage(driver.webDriver);
    //   await widget.pageLoad();
    //   await widget.selectExistingAccountByEmail(user1.email!);

    //   // Immediately reauth but with the wrong user
    //   await driver.reinitOnRedirect();
    //   await driver.callNoWait(RedirectFunction.IDP_REAUTH_REDIRECT);
    //   await widget.pageLoad();
    //   await widget.selectExistingAccountByEmail(user2.email!);

    //   await driver.reinitOnRedirect();
    //   await expect(
    //     driver.call(RedirectFunction.REDIRECT_RESULT)
    //   ).to.be.rejected.and.eventually.have.property(
    //     'code',
    //     'auth/user-mismatch'
    //   );
    // });

    // it('13 - handles aborted sign ins', async () => {
    //   await driver.callNoWait(RedirectFunction.IDP_REDIRECT);
    //   const widget = new IdPPage(driver.webDriver);

    //   // Don't actually sign in; go back to the previous page
    //   await widget.pageLoad();
    //   await driver.goToTestPage();
    //   await driver.reinitOnRedirect();
    //   expect(await driver.getUserSnapshot()).to.be.null;

    //   // Now do sign in
    //   await driver.callNoWait(RedirectFunction.IDP_REDIRECT);
    //   // Use user1
    //   await widget.pageLoad();
    //   await widget.selectExistingAccountByEmail(user1.email!);

    //   // Ensure the user was signed in...
    //   await driver.reinitOnRedirect();
    //   let user13 = await driver.getUserSnapshot();
    //   console.log('13a - currentUser.email: ', user13.email);
    //   expect(user13.uid).to.eq(user1.uid);
    //   expect(user13.email).to.eq(user1.email);

    //   // Now open another sign in, but return
    //   await driver.callNoWait(RedirectFunction.IDP_REAUTH_REDIRECT);
    //   await widget.pageLoad();
    //   await driver.goToTestPage();
    //   await driver.reinitOnRedirect();

    //   // Make sure state remained
    //   user13 = await driver.getUserSnapshot();
    //   console.log('13b - currentUser.email: ', user13.email);
    //   expect(user13.uid).to.eq(user1.uid);
    //   expect(user13.email).to.eq(user1.email);
    // });
  });
});
