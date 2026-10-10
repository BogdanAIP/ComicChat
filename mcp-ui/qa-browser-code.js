async (page) => {
  const frame = page.frameLocator('iframe');
  await frame.getByTestId('comicchat-nav').waitFor();
  await frame.getByTestId('groups-nav').click();
  await frame.getByTestId('comic-group-shell').waitFor();
  await frame.getByRole('textbox', { name: 'New group name' }).fill('GPT QA Group');
  await frame.getByRole('button', { name: 'Create', exact: true }).click();
  await frame.getByTestId('comic-group-entry').filter({ hasText: 'GPT QA Group' }).waitFor();
  return { status: 'group-created', calls: await page.evaluate(() => window.qaCalls.map(c => ({ name: c.name, operation: c.arguments?.request?.operation }))) };
}